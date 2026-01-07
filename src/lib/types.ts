import { AdminConfig } from './admin.types';

// 用户元数据
export interface UserMeta {
  createdAt: number; // 注册时间戳
  lastActiveAt: number; // 最后活跃时间戳
  loginCount: number; // 登录次数
  firstLoginTime?: number; // 首次登入时间戳
}

// API调用日志
export interface ApiCallLog {
  timestamp: number;
  source: string;
  sourceName: string;
  success: boolean;
  error?: string;
  responseTime?: number;
}

// 在线会话
export interface UserSession {
  username: string;
  sessionId: string;
  lastActiveAt: number;
  ipAddress?: string;
  userAgent?: string;
}

// 广告系统
export interface Advertisement {
  id: string; // 广告唯一ID
  position: string; // 广告位标识 (home_banner, player_bottom, sidebar_top等)
  type: 'image' | 'video' | 'js'; // 广告类型
  title: string; // 广告标题
  materialUrl: string; // 素材链接（图片/视频URL或JS代码）
  clickUrl?: string; // 点击跳转地址（可选）
  width?: number; // 广告宽度
  height?: number; // 广告高度
  startDate: number; // 生效日期（时间戳）
  endDate: number; // 失效日期（时间戳）
  enabled: boolean; // 是否开启
  priority: number; // 优先级（数字越大优先级越高）
  createdAt: number; // 创建时间
  updatedAt: number; // 更新时间
}

// 播放记录数据结构
export interface PlayRecord {
  title: string;
  source_name: string;
  cover: string;
  year: string;
  index: number; // 第几集
  total_episodes: number; // 总集数
  play_time: number; // 播放进度（秒）
  total_time: number; // 总进度（秒）
  save_time: number; // 记录保存时间（时间戳）
  search_title: string; // 搜索时使用的标题
}

// 收藏数据结构
export interface Favorite {
  source_name: string;
  total_episodes: number; // 总集数
  title: string;
  year: string;
  cover: string;
  save_time: number; // 记录保存时间（时间戳）
  search_title: string; // 搜索时使用的标题
  origin?: 'vod' | 'live';
}

// 存储接口
export interface IStorage {
  // 播放记录相关
  getPlayRecord(userName: string, key: string): Promise<PlayRecord | null>;
  setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void>;
  getAllPlayRecords(userName: string): Promise<{ [key: string]: PlayRecord }>;
  deletePlayRecord(userName: string, key: string): Promise<void>;

  // 收藏相关
  getFavorite(userName: string, key: string): Promise<Favorite | null>;
  setFavorite(userName: string, key: string, favorite: Favorite): Promise<void>;
  getAllFavorites(userName: string): Promise<{ [key: string]: Favorite }>;
  deleteFavorite(userName: string, key: string): Promise<void>;

  // 用户相关
  registerUser(userName: string, password: string): Promise<void>;
  verifyUser(userName: string, password: string): Promise<boolean>;
  // 检查用户是否存在（无需密码）
  checkUserExist(userName: string): Promise<boolean>;
  // 修改用户密码
  changePassword(userName: string, newPassword: string): Promise<void>;
  // 删除用户（包括密码、搜索历史、播放记录、收藏夹）
  deleteUser(userName: string): Promise<void>;

  // 搜索历史相关
  getSearchHistory(userName: string): Promise<string[]>;
  addSearchHistory(userName: string, keyword: string): Promise<void>;
  deleteSearchHistory(userName: string, keyword?: string): Promise<void>;

  // 用户列表
  getAllUsers(): Promise<string[]>;

  // 管理员配置相关
  getAdminConfig(): Promise<AdminConfig | null>;
  setAdminConfig(config: AdminConfig): Promise<void>;

  // 跳过片头片尾配置相关
  getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null>;
  setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void>;
  deleteSkipConfig(userName: string, source: string, id: string): Promise<void>;
  getAllSkipConfigs(userName: string): Promise<{ [key: string]: SkipConfig }>;

  // 用户元数据
  getUserMeta(userName: string): Promise<UserMeta | null>;
  setUserMeta(userName: string, meta: UserMeta): Promise<void>;
  
  // API调用日志
  addApiCallLog(log: ApiCallLog): Promise<void>;
  getApiCallLogs(limit?: number): Promise<ApiCallLog[]>;
  
  // 在线会话
  setUserSession(session: UserSession): Promise<void>;
  getUserSession(sessionId: string): Promise<UserSession | null>;
  deleteUserSession(sessionId: string): Promise<void>;
  getAllActiveSessions(timeoutMinutes?: number): Promise<UserSession[]>;

  // 广告管理
  createAdvertisement(ad: Advertisement): Promise<void>;
  updateAdvertisement(id: string, ad: Partial<Advertisement>): Promise<void>;
  deleteAdvertisement(id: string): Promise<void>;
  getAdvertisement(id: string): Promise<Advertisement | null>;
  getAllAdvertisements(): Promise<Advertisement[]>;
  getActiveAdvertisements(position?: string): Promise<Advertisement[]>;

  // 数据清理相关
  clearAllData(): Promise<void>;
}

// 搜索结果数据结构
export interface SearchResult {
  id: string;
  title: string;
  poster: string;
  episodes: string[];
  episodes_titles: string[];
  source: string;
  source_name: string;
  class?: string;
  year: string;
  desc?: string;
  type_name?: string;
  douban_id?: number;
}

// 豆瓣数据结构
export interface DoubanItem {
  id: string;
  title: string;
  poster: string;
  rate: string;
  year: string;
  plot_summary?: string; // 剧情简介（可选）
  backdrop?: string; // 背景图（可选，从详情获取）
  trailerUrl?: string; // 预告片URL（可选，从详情获取）
}

export interface DoubanResult {
  code: number;
  message: string;
  list: DoubanItem[];
}

// 跳过片头片尾配置数据结构
export interface SkipConfig {
  enable: boolean; // 是否启用跳过片头片尾
  intro_time: number; // 片头时间（秒）
  outro_time: number; // 片尾时间（秒）
}

// 用户播放统计
export interface UserPlayStat {
  username: string;
  totalWatchTime: number;
  totalPlays: number;
  lastPlayTime: number;
  recentRecords: PlayRecord[];
  avgWatchTime: number;
  mostWatchedSource: string;
  registrationDays: number;
  lastLoginTime: number;
  loginCount: number;
  createdAt: number;
  firstWatchDate?: number;
  lastLoginDate?: number;
  firstLoginTime?: number;
  loginDays?: number;
  totalMovies?: number;
}

// 全站播放统计数据结构
export interface PlayStatsResult {
  totalUsers: number;
  totalWatchTime: number;
  totalPlays: number;
  avgWatchTimePerUser: number;
  avgPlaysPerUser: number;
  userStats: UserPlayStat[];
  topSources: Array<{
    source: string;
    count: number;
  }>;
  dailyStats: Array<{
    date: string;
    watchTime: number;
    plays: number;
  }>;
  registrationStats: {
    todayNewUsers: number;
    totalRegisteredUsers: number;
    registrationTrend: Array<{
      date: string;
      newUsers: number;
    }>;
  };
  activeUsers: {
    daily: number;
    weekly: number;
    monthly: number;
  };
}
