/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { createClient, RedisClientType } from 'redis';

import { AdminConfig } from './admin.types';
import {
  Advertisement,
  ApiCallLog,
  Favorite,
  IStorage,
  PlayRecord,
  SkipConfig,
  UserMeta,
  UserSession} from './types';

// 搜索历史最大条数
const SEARCH_HISTORY_LIMIT = 20;

// 数据类型转换辅助函数
function ensureString(value: any): string {
  return String(value);
}

function ensureStringArray(value: any[]): string[] {
  return value.map((item) => String(item));
}

// 连接配置接口
export interface RedisConnectionConfig {
  url: string;
  clientName: string; // 用于日志显示，如 "Redis" 或 "Pika"
}

// 添加Redis操作重试包装器
function createRetryWrapper(clientName: string, getClient: () => RedisClientType) {
  return async function withRetry<T>(
    operation: () => Promise<T>,
    maxRetries = 3
  ): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (err: any) {
        const isLastAttempt = i === maxRetries - 1;
        const isConnectionError =
          err.message?.includes('Connection') ||
          err.message?.includes('ECONNREFUSED') ||
          err.message?.includes('ENOTFOUND') ||
          err.code === 'ECONNRESET' ||
          err.code === 'EPIPE';

        if (isConnectionError && !isLastAttempt) {
          console.log(
            `${clientName} operation failed, retrying... (${i + 1}/${maxRetries})`
          );
          console.error('Error:', err.message);

          // 等待一段时间后重试
          await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));

          // 尝试重新连接
          try {
            const client = getClient();
            if (!client.isOpen) {
              await client.connect();
            }
          } catch (reconnectErr) {
            console.error('Failed to reconnect:', reconnectErr);
          }

          continue;
        }

        throw err;
      }
    }

    throw new Error('Max retries exceeded');
  };
}

// 创建客户端的工厂函数
export function createRedisClient(config: RedisConnectionConfig, globalSymbol: symbol): RedisClientType {
  let client: RedisClientType | undefined = (global as any)[globalSymbol];

  if (!client) {
    if (!config.url) {
      throw new Error(`${config.clientName}_URL env variable not set`);
    }

    // 创建客户端配置
    const clientConfig: any = {
      url: config.url,
      socket: {
        // 重连策略：指数退避，最大30秒
        reconnectStrategy: (retries: number) => {
          console.log(`${config.clientName} reconnection attempt ${retries + 1}`);
          if (retries > 10) {
            console.error(`${config.clientName} max reconnection attempts exceeded`);
            return false; // 停止重连
          }
          return Math.min(1000 * Math.pow(2, retries), 30000); // 指数退避，最大30秒
        },
        connectTimeout: 10000, // 10秒连接超时
        // 设置no delay，减少延迟
        noDelay: true,
      },
      // 添加其他配置
      pingInterval: 30000, // 30秒ping一次，保持连接活跃
    };

    client = createClient(clientConfig);

    // 添加错误事件监听
    client.on('error', (err) => {
      console.error(`${config.clientName} client error:`, err);
    });

    client.on('connect', () => {
      console.log(`${config.clientName} connected`);
    });

    client.on('reconnecting', () => {
      console.log(`${config.clientName} reconnecting...`);
    });

    client.on('ready', () => {
      console.log(`${config.clientName} ready`);
    });

    // 初始连接，带重试机制
    const connectWithRetry = async () => {
      try {
        await client!.connect();
        console.log(`${config.clientName} connected successfully`);
      } catch (err) {
        console.error(`${config.clientName} initial connection failed:`, err);
        console.log('Will retry in 5 seconds...');
        setTimeout(connectWithRetry, 5000);
      }
    };

    connectWithRetry();

    (global as any)[globalSymbol] = client;
  }

  return client;
}

// 抽象基类，包含所有通用的Redis操作逻辑
export abstract class BaseRedisStorage implements IStorage {
  protected client: RedisClientType;
  protected withRetry: <T>(operation: () => Promise<T>, maxRetries?: number) => Promise<T>;

  constructor(config: RedisConnectionConfig, globalSymbol: symbol) {
    this.client = createRedisClient(config, globalSymbol);
    this.withRetry = createRetryWrapper(config.clientName, () => this.client);
  }

  // ---------- 播放记录 ----------
  private prKey(user: string, key: string) {
    return `u:${user}:pr:${key}`; // u:username:pr:source+id
  }

  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    const val = await this.withRetry(() =>
      this.client.get(this.prKey(userName, key))
    );
    return val ? (JSON.parse(val) as PlayRecord) : null;
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    await this.withRetry(() =>
      this.client.set(this.prKey(userName, key), JSON.stringify(record))
    );
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, PlayRecord>> {
    const pattern = `u:${userName}:pr:*`;
    const keys: string[] = await this.withRetry(() => this.client.keys(pattern));
    if (keys.length === 0) return {};
    const values = await this.withRetry(() => this.client.mGet(keys));
    const result: Record<string, PlayRecord> = {};
    keys.forEach((fullKey: string, idx: number) => {
      const raw = values[idx];
      if (raw) {
        const rec = JSON.parse(raw) as PlayRecord;
        // 截取 source+id 部分
        const keyPart = ensureString(fullKey.replace(`u:${userName}:pr:`, ''));
        result[keyPart] = rec;
      }
    });
    return result;
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    await this.withRetry(() => this.client.del(this.prKey(userName, key)));
  }

  // ---------- 收藏 ----------
  private favKey(user: string, key: string) {
    return `u:${user}:fav:${key}`;
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    const val = await this.withRetry(() =>
      this.client.get(this.favKey(userName, key))
    );
    return val ? (JSON.parse(val) as Favorite) : null;
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    await this.withRetry(() =>
      this.client.set(this.favKey(userName, key), JSON.stringify(favorite))
    );
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    const pattern = `u:${userName}:fav:*`;
    const keys: string[] = await this.withRetry(() => this.client.keys(pattern));
    if (keys.length === 0) return {};
    const values = await this.withRetry(() => this.client.mGet(keys));
    const result: Record<string, Favorite> = {};
    keys.forEach((fullKey: string, idx: number) => {
      const raw = values[idx];
      if (raw) {
        const fav = JSON.parse(raw) as Favorite;
        const keyPart = ensureString(fullKey.replace(`u:${userName}:fav:`, ''));
        result[keyPart] = fav;
      }
    });
    return result;
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    await this.withRetry(() => this.client.del(this.favKey(userName, key)));
  }

  // ---------- 用户注册 / 登录 ----------
  private userPwdKey(user: string) {
    return `u:${user}:pwd`;
  }

  async registerUser(userName: string, password: string): Promise<void> {
    // 简单存储明文密码，生产环境应加密
    await this.withRetry(() => this.client.set(this.userPwdKey(userName), password));
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    const stored = await this.withRetry(() =>
      this.client.get(this.userPwdKey(userName))
    );
    if (stored === null) return false;
    // 确保比较时都是字符串类型
    return ensureString(stored) === password;
  }

  // 检查用户是否存在
  async checkUserExist(userName: string): Promise<boolean> {
    // 使用 EXISTS 判断 key 是否存在
    const exists = await this.withRetry(() =>
      this.client.exists(this.userPwdKey(userName))
    );
    return exists === 1;
  }

  // 修改用户密码
  async changePassword(userName: string, newPassword: string): Promise<void> {
    // 简单存储明文密码，生产环境应加密
    await this.withRetry(() =>
      this.client.set(this.userPwdKey(userName), newPassword)
    );
  }

  // 删除用户及其所有数据
  async deleteUser(userName: string): Promise<void> {
    // 删除用户密码
    await this.withRetry(() => this.client.del(this.userPwdKey(userName)));

    // 删除搜索历史
    await this.withRetry(() => this.client.del(this.shKey(userName)));

    // 删除播放记录
    const playRecordPattern = `u:${userName}:pr:*`;
    const playRecordKeys = await this.withRetry(() =>
      this.client.keys(playRecordPattern)
    );
    if (playRecordKeys.length > 0) {
      await this.withRetry(() => this.client.del(playRecordKeys));
    }

    // 删除收藏夹
    const favoritePattern = `u:${userName}:fav:*`;
    const favoriteKeys = await this.withRetry(() =>
      this.client.keys(favoritePattern)
    );
    if (favoriteKeys.length > 0) {
      await this.withRetry(() => this.client.del(favoriteKeys));
    }

    // 删除跳过片头片尾配置
    const skipConfigPattern = `u:${userName}:skip:*`;
    const skipConfigKeys = await this.withRetry(() =>
      this.client.keys(skipConfigPattern)
    );
    if (skipConfigKeys.length > 0) {
      await this.withRetry(() => this.client.del(skipConfigKeys));
    }

    // 删除用户登入统计数据
    const loginStatsKey = this.userLoginStatsKey(userName);
    await this.withRetry(() => this.client.del(loginStatsKey));

    // 删除用户元数据
    await this.withRetry(() => this.client.del(this.userMetaKey(userName)));
  }

  // ---------- 搜索历史 ----------
  private shKey(user: string) {
    return `u:${user}:sh`; // u:username:sh
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    const result = await this.withRetry(() =>
      this.client.lRange(this.shKey(userName), 0, -1)
    );
    // 确保返回的都是字符串类型
    return ensureStringArray(result as any[]);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    const key = this.shKey(userName);
    // 先去重
    await this.withRetry(() => this.client.lRem(key, 0, ensureString(keyword)));
    // 插入到最前
    await this.withRetry(() => this.client.lPush(key, ensureString(keyword)));
    // 限制最大长度
    await this.withRetry(() => this.client.lTrim(key, 0, SEARCH_HISTORY_LIMIT - 1));
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    const key = this.shKey(userName);
    if (keyword) {
      await this.withRetry(() => this.client.lRem(key, 0, ensureString(keyword)));
    } else {
      await this.withRetry(() => this.client.del(key));
    }
  }

  // ---------- 获取全部用户 ----------
  async getAllUsers(): Promise<string[]> {
    const keys = await this.withRetry(() => this.client.keys('u:*:pwd'));
    return keys
      .map((k) => {
        const match = k.match(/^u:(.+?):pwd$/);
        return match ? ensureString(match[1]) : undefined;
      })
      .filter((u): u is string => typeof u === 'string');
  }

  // ---------- 管理员配置 ----------
  private adminConfigKey() {
    return 'admin:config';
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    const val = await this.withRetry(() => this.client.get(this.adminConfigKey()));
    return val ? (JSON.parse(val) as AdminConfig) : null;
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    await this.withRetry(() =>
      this.client.set(this.adminConfigKey(), JSON.stringify(config))
    );
  }

  // ---------- 跳过片头片尾配置 ----------
  private skipConfigKey(user: string, source: string, id: string) {
    return `u:${user}:skip:${source}+${id}`;
  }

  async getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null> {
    const val = await this.withRetry(() =>
      this.client.get(this.skipConfigKey(userName, source, id))
    );
    return val ? (JSON.parse(val) as SkipConfig) : null;
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void> {
    await this.withRetry(() =>
      this.client.set(
        this.skipConfigKey(userName, source, id),
        JSON.stringify(config)
      )
    );
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    await this.withRetry(() =>
      this.client.del(this.skipConfigKey(userName, source, id))
    );
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: SkipConfig }> {
    const pattern = `u:${userName}:skip:*`;
    const keys = await this.withRetry(() => this.client.keys(pattern));

    if (keys.length === 0) {
      return {};
    }

    const configs: { [key: string]: SkipConfig } = {};

    // 批量获取所有配置
    const values = await this.withRetry(() => this.client.mGet(keys));

    keys.forEach((key, index) => {
      const value = values[index];
      if (value) {
        // 从key中提取source+id
        const match = key.match(/^u:.+?:skip:(.+)$/);
        if (match) {
          const sourceAndId = match[1];
          configs[sourceAndId] = JSON.parse(value as string) as SkipConfig;
        }
      }
    });

    return configs;
  }

  // 清空所有数据
  async clearAllData(): Promise<void> {
    try {
      // 获取所有用户
      const allUsers = await this.getAllUsers();

      // 删除所有用户及其数据
      for (const username of allUsers) {
        await this.deleteUser(username);
      }

      // 删除管理员配置
      await this.withRetry(() => this.client.del(this.adminConfigKey()));

      console.log('所有数据已清空');
    } catch (error) {
      console.error('清空数据失败:', error);
      throw new Error('清空数据失败');
    }
  }

  // ---------- 用户元数据 ----------
  private userMetaKey(user: string) {
    return `u:${user}:meta`;
  }

  async getUserMeta(userName: string): Promise<UserMeta | null> {
    const val = await this.withRetry(() =>
      this.client.get(this.userMetaKey(userName))
    );
    return val ? (JSON.parse(val) as UserMeta) : null;
  }

  async setUserMeta(userName: string, meta: UserMeta): Promise<void> {
    await this.withRetry(() =>
      this.client.set(this.userMetaKey(userName), JSON.stringify(meta))
    );
  }

  // ---------- 用户登入统计（独立存储，用于非活跃用户清理）----------
  private userLoginStatsKey(user: string) {
    return `user_login_stats:${user}`;
  }

  async getUserLoginStats(userName: string): Promise<{
    loginCount: number;
    firstLoginTime: number;
    lastLoginTime: number;
    lastLoginDate: number;
  } | null> {
    try {
      const val = await this.withRetry(() =>
        this.client.get(this.userLoginStatsKey(userName))
      );
      if (!val) return null;
      const parsed = JSON.parse(val);
      return {
        loginCount: parsed.loginCount || 0,
        firstLoginTime: parsed.firstLoginTime || 0,
        lastLoginTime: parsed.lastLoginTime || 0,
        lastLoginDate: parsed.lastLoginDate || parsed.lastLoginTime || 0
      };
    } catch (error) {
      console.error(`获取用户 ${userName} 登入统计失败:`, error);
      return null;
    }
  }

  async updateUserLoginStats(
    userName: string,
    loginTime: number,
    isFirstLogin?: boolean
  ): Promise<void> {
    try {
      const loginStatsKey = this.userLoginStatsKey(userName);

      // 获取当前登入统计数据
      const currentStats = await this.client.get(loginStatsKey);
      const loginStats = currentStats ? JSON.parse(currentStats) : {
        loginCount: 0,
        firstLoginTime: null,
        lastLoginTime: null,
        lastLoginDate: null
      };

      // 更新统计数据
      loginStats.loginCount = (loginStats.loginCount || 0) + 1;
      loginStats.lastLoginTime = loginTime;
      loginStats.lastLoginDate = loginTime; // 保持兼容性

      // 如果是首次登入，记录首次登入时间
      if (isFirstLogin || !loginStats.firstLoginTime) {
        loginStats.firstLoginTime = loginTime;
      }

      // 保存到 Redis
      await this.withRetry(() =>
        this.client.set(loginStatsKey, JSON.stringify(loginStats))
      );

      console.log(`用户 ${userName} 登入统计已更新:`, loginStats);
    } catch (error) {
      console.error(`更新用户 ${userName} 登入统计失败:`, error);
      throw error;
    }
  }

  // ---------- API调用日志 ----------
  private apiCallLogsKey() {
    return 'api:call:logs';
  }

  async addApiCallLog(log: ApiCallLog): Promise<void> {
    const key = this.apiCallLogsKey();
    const logStr = JSON.stringify(log);
    
    await this.withRetry(async () => {
      // 使用sorted set存储，按时间戳排序
      await this.client.zAdd(key, {
        score: log.timestamp,
        value: logStr
      });
      
      // 只保留最近1000条日志
      const count = await this.client.zCard(key);
      if (count > 1000) {
        await this.client.zRemRangeByRank(key, 0, count - 1001);
      }
    });
  }

  async getApiCallLogs(limit = 100): Promise<ApiCallLog[]> {
    const key = this.apiCallLogsKey();
    const logs = await this.withRetry(() =>
      this.client.zRange(key, 0, limit - 1, { REV: true })
    );
    return logs.map((log) => JSON.parse(log) as ApiCallLog);
  }

  // ---------- 在线会话 ----------
  private sessionKey(sessionId: string) {
    return `session:${sessionId}`;
  }

  private activeSessionsKey() {
    return 'sessions:active';
  }

  async setUserSession(session: UserSession): Promise<void> {
    await this.withRetry(async () => {
      // 存储会话数据，1小时过期
      await this.client.setEx(
        this.sessionKey(session.sessionId),
        3600,
        JSON.stringify(session)
      );
      
      // 在活跃会话索引中记录
      await this.client.zAdd(this.activeSessionsKey(), {
        score: session.lastActiveAt,
        value: session.sessionId
      });
    });
  }

  async getUserSession(sessionId: string): Promise<UserSession | null> {
    const val = await this.withRetry(() =>
      this.client.get(this.sessionKey(sessionId))
    );
    return val ? (JSON.parse(val) as UserSession) : null;
  }

  async deleteUserSession(sessionId: string): Promise<void> {
    await this.withRetry(async () => {
      await this.client.del(this.sessionKey(sessionId));
      await this.client.zRem(this.activeSessionsKey(), sessionId);
    });
  }

  async getAllActiveSessions(timeoutMinutes = 30): Promise<UserSession[]> {
    const now = Date.now();
    const cutoffTime = now - timeoutMinutes * 60 * 1000;
    
    // 获取活跃的sessionId列表
    const sessionIds = await this.withRetry(() =>
      this.client.zRangeByScore(
        this.activeSessionsKey(),
        cutoffTime,
        '+inf'
      )
    );
    
    const sessions: UserSession[] = [];
    for (const sessionId of sessionIds) {
      const session = await this.getUserSession(sessionId);
      if (session) {
        sessions.push(session);
      }
    }
    
    // 清理过期的会话ID
    await this.withRetry(() =>
      this.client.zRemRangeByScore(
        this.activeSessionsKey(),
        '-inf',
        cutoffTime
      )
    );
    
    return sessions;
  }

  // ---------- 广告管理 ----------
  private advertisementKey(id: string) {
    return `advertisement:${id}`;
  }

  private advertisementsIndexKey() {
    return 'advertisements:index';
  }

  async createAdvertisement(ad: Advertisement): Promise<void> {
    await this.withRetry(async () => {
      // 保存广告数据
      await this.client.set(this.advertisementKey(ad.id), JSON.stringify(ad));
      
      // 添加到索引集合
      await this.client.sAdd(this.advertisementsIndexKey(), ad.id);
    });
  }

  async updateAdvertisement(id: string, updates: Partial<Advertisement>): Promise<void> {
    await this.withRetry(async () => {
      const existing = await this.getAdvertisement(id);
      if (!existing) {
        throw new Error('广告不存在');
      }
      
      const updated: Advertisement = {
        ...existing,
        ...updates,
        updatedAt: Date.now()
      };
      
      await this.client.set(this.advertisementKey(id), JSON.stringify(updated));
    });
  }

  async deleteAdvertisement(id: string): Promise<void> {
    await this.withRetry(async () => {
      await this.client.del(this.advertisementKey(id));
      await this.client.sRem(this.advertisementsIndexKey(), id);
    });
  }

  async getAdvertisement(id: string): Promise<Advertisement | null> {
    const data = await this.withRetry(() =>
      this.client.get(this.advertisementKey(id))
    );
    return data ? (JSON.parse(data) as Advertisement) : null;
  }

  async getAllAdvertisements(): Promise<Advertisement[]> {
    const ids = await this.withRetry(() =>
      this.client.sMembers(this.advertisementsIndexKey())
    );
    
    if (ids.length === 0) return [];
    
    const ads: Advertisement[] = [];
    for (const id of ids) {
      const ad = await this.getAdvertisement(id);
      if (ad) {
        ads.push(ad);
      }
    }
    
    return ads;
  }

  async getActiveAdvertisements(position?: string): Promise<Advertisement[]> {
    const allAds = await this.getAllAdvertisements();
    const now = Date.now();
    
    console.log(`筛选广告 - position: ${position || 'all'}, 总数: ${allAds.length}, 当前时间: ${new Date(now).toISOString()}`);
    
    // 筛选条件：已开启 && 在有效期内 && (如果指定了位置则匹配位置)
    const activeAds = allAds.filter(ad => {
      const isEnabled = ad.enabled;
      const isInValidPeriod = now >= ad.startDate && now <= ad.endDate;
      const matchesPosition = !position || ad.position === position;
      
      console.log(`广告 ${ad.id} (${ad.position}): enabled=${isEnabled}, inPeriod=${isInValidPeriod}, matchPos=${matchesPosition}, start=${new Date(ad.startDate).toISOString()}, end=${new Date(ad.endDate).toISOString()}`);
      
      return isEnabled && isInValidPeriod && matchesPosition;
    });
    
    console.log(`筛选后广告数: ${activeAds.length}`);
    
    // 按优先级排序（降序）
    return activeAds.sort((a, b) => b.priority - a.priority);
  }
}
