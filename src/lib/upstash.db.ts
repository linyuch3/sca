/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { Redis } from '@upstash/redis';

import { AdminConfig } from './admin.types';
import { 
  Advertisement, 
  ApiCallLog, 
  Favorite, 
  IStorage, 
  PlayRecord, 
  SkipConfig, 
  UserMeta, 
  UserSession 
} from './types';

// 搜索历史最大条数
const SEARCH_HISTORY_LIMIT = 20;

// 数据类型转换辅助函数
function ensureString(value: any): string {
  return String(value);
}

function ensureStringArray(value: any[]): string[] {
  return value.map((item) => String(item));
}

// 添加Upstash Redis操作重试包装器
async function withRetry<T>(
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
        err.code === 'EPIPE' ||
        err.name === 'UpstashError';

      if (isConnectionError && !isLastAttempt) {
        console.log(
          `Upstash Redis operation failed, retrying... (${i + 1}/${maxRetries})`
        );
        console.error('Error:', err.message);

        // 等待一段时间后重试
        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
        continue;
      }

      throw err;
    }
  }

  throw new Error('Max retries exceeded');
}

export class UpstashRedisStorage implements IStorage {
  private client: Redis;

  constructor() {
    this.client = getUpstashRedisClient();
  }

  // ---------- 播放记录 ----------
  private prKey(user: string, key: string) {
    return `u:${user}:pr:${key}`; // u:username:pr:source+id
  }

  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    const val = await withRetry(() =>
      this.client.get(this.prKey(userName, key))
    );
    return val ? (val as PlayRecord) : null;
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    await withRetry(() => this.client.set(this.prKey(userName, key), record));
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, PlayRecord>> {
    const pattern = `u:${userName}:pr:*`;
    const keys: string[] = await withRetry(() => this.client.keys(pattern));
    if (keys.length === 0) return {};

    const result: Record<string, PlayRecord> = {};
    for (const fullKey of keys) {
      const value = await withRetry(() => this.client.get(fullKey));
      if (value) {
        // 截取 source+id 部分
        const keyPart = ensureString(fullKey.replace(`u:${userName}:pr:`, ''));
        result[keyPart] = value as PlayRecord;
      }
    }
    return result;
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    await withRetry(() => this.client.del(this.prKey(userName, key)));
  }

  // ---------- 收藏 ----------
  private favKey(user: string, key: string) {
    return `u:${user}:fav:${key}`;
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    const val = await withRetry(() =>
      this.client.get(this.favKey(userName, key))
    );
    return val ? (val as Favorite) : null;
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    await withRetry(() =>
      this.client.set(this.favKey(userName, key), favorite)
    );
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    const pattern = `u:${userName}:fav:*`;
    const keys: string[] = await withRetry(() => this.client.keys(pattern));
    if (keys.length === 0) return {};

    const result: Record<string, Favorite> = {};
    for (const fullKey of keys) {
      const value = await withRetry(() => this.client.get(fullKey));
      if (value) {
        const keyPart = ensureString(fullKey.replace(`u:${userName}:fav:`, ''));
        result[keyPart] = value as Favorite;
      }
    }
    return result;
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    await withRetry(() => this.client.del(this.favKey(userName, key)));
  }

  // ---------- 用户注册 / 登录 ----------
  private userPwdKey(user: string) {
    return `u:${user}:pwd`;
  }

  async registerUser(userName: string, password: string): Promise<void> {
    // 简单存储明文密码，生产环境应加密
    await withRetry(() => this.client.set(this.userPwdKey(userName), password));
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    const stored = await withRetry(() =>
      this.client.get(this.userPwdKey(userName))
    );
    if (stored === null) return false;
    // 确保比较时都是字符串类型
    return ensureString(stored) === password;
  }

  // 检查用户是否存在
  async checkUserExist(userName: string): Promise<boolean> {
    // 使用 EXISTS 判断 key 是否存在
    const exists = await withRetry(() =>
      this.client.exists(this.userPwdKey(userName))
    );
    return exists === 1;
  }

  // 修改用户密码
  async changePassword(userName: string, newPassword: string): Promise<void> {
    // 简单存储明文密码，生产环境应加密
    await withRetry(() =>
      this.client.set(this.userPwdKey(userName), newPassword)
    );
  }

  // 删除用户及其所有数据
  async deleteUser(userName: string): Promise<void> {
    // 删除用户密码
    await withRetry(() => this.client.del(this.userPwdKey(userName)));

    // 删除搜索历史
    await withRetry(() => this.client.del(this.shKey(userName)));

    // 删除播放记录
    const playRecordPattern = `u:${userName}:pr:*`;
    const playRecordKeys = await withRetry(() =>
      this.client.keys(playRecordPattern)
    );
    if (playRecordKeys.length > 0) {
      await withRetry(() => this.client.del(...playRecordKeys));
    }

    // 删除收藏夹
    const favoritePattern = `u:${userName}:fav:*`;
    const favoriteKeys = await withRetry(() =>
      this.client.keys(favoritePattern)
    );
    if (favoriteKeys.length > 0) {
      await withRetry(() => this.client.del(...favoriteKeys));
    }

    // 删除跳过片头片尾配置
    const skipConfigPattern = `u:${userName}:skip:*`;
    const skipConfigKeys = await withRetry(() =>
      this.client.keys(skipConfigPattern)
    );
    if (skipConfigKeys.length > 0) {
      await withRetry(() => this.client.del(...skipConfigKeys));
    }

    // 删除用户登入统计数据
    const loginStatsKey = this.userLoginStatsKey(userName);
    await withRetry(() => this.client.del(loginStatsKey));

    // 删除用户元数据
    await withRetry(() => this.client.del(this.userMetaKey(userName)));
  }

  // ---------- 搜索历史 ----------
  private shKey(user: string) {
    return `u:${user}:sh`; // u:username:sh
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    const result = await withRetry(() =>
      this.client.lrange(this.shKey(userName), 0, -1)
    );
    // 确保返回的都是字符串类型
    return ensureStringArray(result as any[]);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    const key = this.shKey(userName);
    // 先去重
    await withRetry(() => this.client.lrem(key, 0, ensureString(keyword)));
    // 插入到最前
    await withRetry(() => this.client.lpush(key, ensureString(keyword)));
    // 限制最大长度
    await withRetry(() => this.client.ltrim(key, 0, SEARCH_HISTORY_LIMIT - 1));
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    const key = this.shKey(userName);
    if (keyword) {
      await withRetry(() => this.client.lrem(key, 0, ensureString(keyword)));
    } else {
      await withRetry(() => this.client.del(key));
    }
  }

  // ---------- 获取全部用户 ----------
  async getAllUsers(): Promise<string[]> {
    const keys = await withRetry(() => this.client.keys('u:*:pwd'));
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
    const val = await withRetry(() => this.client.get(this.adminConfigKey()));
    return val ? (val as AdminConfig) : null;
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    await withRetry(() => this.client.set(this.adminConfigKey(), config));
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
    const val = await withRetry(() =>
      this.client.get(this.skipConfigKey(userName, source, id))
    );
    return val ? (val as SkipConfig) : null;
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void> {
    await withRetry(() =>
      this.client.set(this.skipConfigKey(userName, source, id), config)
    );
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    await withRetry(() =>
      this.client.del(this.skipConfigKey(userName, source, id))
    );
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: SkipConfig }> {
    const pattern = `u:${userName}:skip:*`;
    const keys = await withRetry(() => this.client.keys(pattern));

    if (keys.length === 0) {
      return {};
    }

    const configs: { [key: string]: SkipConfig } = {};

    // 批量获取所有配置
    const values = await withRetry(() => this.client.mget(keys));

    keys.forEach((key, index) => {
      const value = values[index];
      if (value) {
        // 从key中提取source+id
        const match = key.match(/^u:.+?:skip:(.+)$/);
        if (match) {
          const sourceAndId = match[1];
          configs[sourceAndId] = value as SkipConfig;
        }
      }
    });

    return configs;
  }

  // ---------- 用户元数据 ----------
  private userMetaKey(user: string) {
    return `u:${user}:meta`;
  }

  async getUserMeta(userName: string): Promise<UserMeta | null> {
    const val = await withRetry(() =>
      this.client.get(this.userMetaKey(userName))
    );
    return val ? (val as UserMeta) : null;
  }

  async setUserMeta(userName: string, meta: UserMeta): Promise<void> {
    await withRetry(() =>
      this.client.set(this.userMetaKey(userName), meta)
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
      const val = await withRetry(() =>
        this.client.get<{
          loginCount?: number;
          firstLoginTime?: number;
          lastLoginTime?: number;
          lastLoginDate?: number;
        }>(this.userLoginStatsKey(userName))
      );
      if (!val) return null;
      return {
        loginCount: val.loginCount || 0,
        firstLoginTime: val.firstLoginTime || 0,
        lastLoginTime: val.lastLoginTime || 0,
        lastLoginDate: val.lastLoginDate || val.lastLoginTime || 0
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
      const currentStats = await this.client.get<{
        loginCount?: number;
        firstLoginTime?: number | null;
        lastLoginTime?: number | null;
        lastLoginDate?: number | null;
      }>(loginStatsKey);
      const loginStats = currentStats || {
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

      // 保存到 Upstash
      await withRetry(() =>
        this.client.set(loginStatsKey, loginStats)
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
    
    await withRetry(async () => {
      // 使用sorted set存储，按时间戳排序
      await this.client.zadd(key, {
        score: log.timestamp,
        member: logStr
      });
      
      // 只保留最近1000条日志
      const count = await this.client.zcard(key);
      if (count > 1000) {
        await this.client.zremrangebyrank(key, 0, count - 1001);
      }
    });
  }

  async getApiCallLogs(limit = 100): Promise<ApiCallLog[]> {
    const key = this.apiCallLogsKey();
    const logs = await withRetry(() =>
      this.client.zrange(key, 0, limit - 1, { rev: true })
    );
    return logs.map((log) => JSON.parse(ensureString(log)) as ApiCallLog);
  }

  // ---------- 在线会话 ----------
  private sessionKey(sessionId: string) {
    return `session:${sessionId}`;
  }

  private activeSessionsKey() {
    return 'sessions:active';
  }

  async setUserSession(session: UserSession): Promise<void> {
    await withRetry(async () => {
      // 存储会话数据，1小时过期
      await this.client.set(
        this.sessionKey(session.sessionId),
        session,
        { ex: 3600 }
      );
      
      // 在活跃会话索引中记录
      await this.client.zadd(this.activeSessionsKey(), {
        score: session.lastActiveAt,
        member: session.sessionId
      });
    });
  }

  async getUserSession(sessionId: string): Promise<UserSession | null> {
    const val = await withRetry(() =>
      this.client.get(this.sessionKey(sessionId))
    );
    return val ? (val as UserSession) : null;
  }

  async deleteUserSession(sessionId: string): Promise<void> {
    await withRetry(async () => {
      await this.client.del(this.sessionKey(sessionId));
      await this.client.zrem(this.activeSessionsKey(), sessionId);
    });
  }

  async getAllActiveSessions(timeoutMinutes = 30): Promise<UserSession[]> {
    const now = Date.now();
    const cutoffTime = now - timeoutMinutes * 60 * 1000;
    
    // 获取活跃的sessionId列表
    const sessionIds = await withRetry(() =>
      this.client.zrange(
        this.activeSessionsKey(),
        cutoffTime,
        '+inf',
        { byScore: true }
      )
    );
    
    const sessions: UserSession[] = [];
    for (const sessionId of sessionIds) {
      const session = await this.getUserSession(ensureString(sessionId));
      if (session) {
        sessions.push(session);
      }
    }
    
    // 清理过期的会话ID
    await withRetry(() =>
      this.client.zremrangebyscore(
        this.activeSessionsKey(),
        -Infinity,
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
    await withRetry(async () => {
      // 保存广告数据
      await this.client.set(this.advertisementKey(ad.id), ad);
      
      // 添加到索引集合
      await this.client.sadd(this.advertisementsIndexKey(), ad.id);
    });
  }

  async updateAdvertisement(id: string, updates: Partial<Advertisement>): Promise<void> {
    await withRetry(async () => {
      const existing = await this.getAdvertisement(id);
      if (!existing) {
        throw new Error('广告不存在');
      }
      
      const updated: Advertisement = {
        ...existing,
        ...updates,
        updatedAt: Date.now()
      };
      
      await this.client.set(this.advertisementKey(id), updated);
    });
  }

  async deleteAdvertisement(id: string): Promise<void> {
    await withRetry(async () => {
      await this.client.del(this.advertisementKey(id));
      await this.client.srem(this.advertisementsIndexKey(), id);
    });
  }

  async getAdvertisement(id: string): Promise<Advertisement | null> {
    const data = await withRetry(() =>
      this.client.get(this.advertisementKey(id))
    );
    return data ? (data as Advertisement) : null;
  }

  async getAllAdvertisements(): Promise<Advertisement[]> {
    const ids = await withRetry(() =>
      this.client.smembers(this.advertisementsIndexKey())
    );
    
    if (ids.length === 0) {
      return [];
    }
    
    const ads: Advertisement[] = [];
    for (const id of ids) {
      const ad = await this.getAdvertisement(ensureString(id));
      if (ad) {
        ads.push(ad);
      }
    }
    
    return ads.sort((a, b) => b.priority - a.priority);
  }

  async getActiveAdvertisements(position?: string): Promise<Advertisement[]> {
    const allAds = await this.getAllAdvertisements();
    const now = Date.now();
    
    return allAds.filter((ad) => {
      if (!ad.enabled) return false;
      if (ad.startDate > now) return false;
      if (ad.endDate < now) return false;
      if (position && ad.position !== position) return false;
      return true;
    });
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
      await withRetry(() => this.client.del(this.adminConfigKey()));

      console.log('所有数据已清空');
    } catch (error) {
      console.error('清空数据失败:', error);
      throw new Error('清空数据失败');
    }
  }
}

// 单例 Upstash Redis 客户端
function getUpstashRedisClient(): Redis {
  const globalKey = Symbol.for('__MOONTV_UPSTASH_REDIS_CLIENT__');
  let client: Redis | undefined = (global as any)[globalKey];

  if (!client) {
    const upstashUrl = process.env.UPSTASH_URL;
    const upstashToken = process.env.UPSTASH_TOKEN;

    if (!upstashUrl || !upstashToken) {
      throw new Error(
        'UPSTASH_URL and UPSTASH_TOKEN env variables must be set'
      );
    }

    // 创建 Upstash Redis 客户端
    client = new Redis({
      url: upstashUrl,
      token: upstashToken,
      // 可选配置
      retry: {
        retries: 3,
        backoff: (retryCount: number) =>
          Math.min(1000 * Math.pow(2, retryCount), 30000),
      },
    });

    console.log('Upstash Redis client created successfully');

    (global as any)[globalKey] = client;
  }

  return client;
}
