/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getApiCallStats } from '@/lib/api-logger';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { getOnlineUsersCount } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存储进行数据统计',
      },
      { status: 400 }
    );
  }

  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 仅站长和管理员可访问
    if (authInfo.role !== 'owner' && authInfo.role !== 'admin') {
      return NextResponse.json({ error: '权限不足' }, { status: 401 });
    }

    const username = authInfo.username;

    // 获取所有用户
    const allUsers = await db.getAllUsers();
    
    // 获取今日新增用户数（使用用户元数据）
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.getTime();
    
    let todayNewUsers = 0;
    let todayActiveUsers = 0;
    
    for (const user of allUsers) {
      const meta = await db.getUserMeta(user);
      if (meta) {
        // 今日注册
        if (meta.createdAt >= todayTimestamp) {
          todayNewUsers++;
        }
        // 今日活跃（最后活跃时间在今天）
        if (meta.lastActiveAt >= todayTimestamp) {
          todayActiveUsers++;
        }
      }
    }

    // 获取累计用户数
    const totalUsers = allUsers.length;

    // 获取播放记录统计
    const playStats: any = {
      dailyRanking: [],
      weeklyRanking: [],
    };

    // 获取所有用户的播放记录并统计
    const allPlayRecords: any = {};
    for (const user of allUsers) {
      const userRecords = await db.getAllPlayRecords(user);
      Object.assign(allPlayRecords, userRecords);
    }

    // 统计播放次数（按影视ID）
    const playCountMap: { [key: string]: any } = {};
    Object.entries(allPlayRecords).forEach(([key, record]: [string, any]) => {
      if (!playCountMap[key]) {
        playCountMap[key] = {
          key,
          title: record.title,
          cover: record.cover,
          source_name: record.source_name,
          count: 0,
          lastPlayTime: 0,
        };
      }
      playCountMap[key].count += 1;
      if (record.save_time > playCountMap[key].lastPlayTime) {
        playCountMap[key].lastPlayTime = record.save_time;
      }
    });

    // 转换为数组并排序
    const playRankingArray = Object.values(playCountMap).sort(
      (a: any, b: any) => b.count - a.count
    );

    // 日榜（最近24小时）
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    playStats.dailyRanking = playRankingArray
      .filter((item: any) => item.lastPlayTime > oneDayAgo)
      .slice(0, 10);

    // 周榜（最近7天）
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    playStats.weeklyRanking = playRankingArray
      .filter((item: any) => item.lastPlayTime > oneWeekAgo)
      .slice(0, 10);

    // 获取搜索热词统计
    const searchStats: { [key: string]: number } = {};
    for (const user of allUsers) {
      const searchHistory = await db.getSearchHistory(user);
      searchHistory.forEach((keyword: string) => {
        searchStats[keyword] = (searchStats[keyword] || 0) + 1;
      });
    }

    const searchRanking = Object.entries(searchStats)
      .map(([keyword, count]) => ({ keyword, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    // 获取API调用统计
    const apiStats = await getApiCallStats(500);

    // 获取实时在线人数
    const onlineUsers = await getOnlineUsersCount(30);

    return NextResponse.json(
      {
        users: {
          todayNew: todayNewUsers,
          total: totalUsers,
          todayActive: todayActiveUsers,
        },
        content: {
          dailyRanking: playStats.dailyRanking,
          weeklyRanking: playStats.weeklyRanking,
          searchRanking,
        },
        system: {
          sourceStats: {
            total: apiStats.total,
            success: apiStats.success,
            failed: apiStats.failed,
            successRate: apiStats.successRate.toFixed(1),
            avgResponseTime: apiStats.avgResponseTime.toFixed(0),
            bySource: apiStats.bySource,
          },
          onlineUsers,
        },
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    console.error('获取统计数据失败:', error);
    return NextResponse.json(
      {
        error: '获取统计数据失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
