/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存储进行个人统计查看',
      },
      { status: 400 }
    );
  }

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const storage = db;
    const username = authInfo.username;

    // 设置项目开始时间
    const PROJECT_START_DATE = new Date('2025-09-14').getTime();

    // 从 UserMeta 获取用户创建时间
    const userMeta = await storage.getUserMeta(username);
    const userCreatedAt = userMeta?.createdAt || PROJECT_START_DATE;

    // 使用自然日计算注册天数
    const firstDate = new Date(userCreatedAt);
    const currentDate = new Date();
    const firstDay = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate());
    const currentDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
    const registrationDays = Math.floor((currentDay.getTime() - firstDay.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // 从独立的登入统计获取登录信息（与 LunaTV 一致）
    const loginStats = await storage.getUserLoginStats(username);
    const loginCount = loginStats?.loginCount || 0;
    const lastLoginTime = loginStats?.lastLoginTime || loginStats?.lastLoginDate || 0;
    const firstLoginTime = loginStats?.firstLoginTime || 0;
    
    // 计算登录天数（从首次登入到现在的自然天数）
    const calculateLoginDays = (startTime: number): number => {
      if (!startTime || startTime <= 0) return 0;
      const startDate = new Date(startTime);
      const currentDate = new Date();
      const startDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
      const currentDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
      const daysDiff = Math.floor((currentDay.getTime() - startDay.getTime()) / (1000 * 60 * 60 * 24));
      return daysDiff + 1;
    };
    
    // 只有在有登录记录时才计算登录天数
    const loginDays = loginCount > 0 ? calculateLoginDays(firstLoginTime) : 0;

    // 获取用户所有播放记录
    const userPlayRecords = await storage.getAllPlayRecords(username);
    const records = Object.values(userPlayRecords);

    if (records.length === 0) {
      return NextResponse.json({
        username,
        totalWatchTime: 0,
        totalPlays: 0,
        lastPlayTime: 0,
        recentRecords: [],
        avgWatchTime: 0,
        mostWatchedSource: '',
        registrationDays,
        loginDays,
        loginCount,
        lastLoginTime: lastLoginTime || userCreatedAt,
        firstLoginTime,
        createdAt: userCreatedAt,
        totalMovies: 0,
      });
    }

    // 计算用户统计
    let totalWatchTime = 0;
    let lastPlayTime = 0;
    const sourceCount: Record<string, number> = {};
    const uniqueMovies = new Set<string>();

    records.forEach((record) => {
      totalWatchTime += record.play_time || 0;

      if (record.save_time > lastPlayTime) {
        lastPlayTime = record.save_time;
      }

      const sourceName = record.source_name || '未知来源';
      sourceCount[sourceName] = (sourceCount[sourceName] || 0) + 1;

      // 统计观看的不同影片
      uniqueMovies.add(record.title);
    });

    // 获取最近播放记录
    const recentRecords = records
      .sort((a, b) => (b.save_time || 0) - (a.save_time || 0))
      .slice(0, 10);

    // 找出最常观看的来源
    let mostWatchedSource = '';
    let maxCount = 0;
    for (const [source, count] of Object.entries(sourceCount)) {
      if (count > maxCount) {
        maxCount = count;
        mostWatchedSource = source;
      }
    }

    const result = {
      username,
      totalWatchTime,
      totalPlays: records.length,
      lastPlayTime,
      recentRecords,
      avgWatchTime: records.length > 0 ? totalWatchTime / records.length : 0,
      mostWatchedSource,
      registrationDays,
      loginDays,
      loginCount,
      lastLoginTime: lastLoginTime || userCreatedAt,
      firstLoginTime,
      createdAt: userCreatedAt,
      totalMovies: uniqueMovies.size,
    };

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('获取个人统计失败:', error);
    return NextResponse.json(
      { error: '获取个人统计失败' },
      { status: 500 }
    );
  }
}

// PUT 方法：记录用户登入时间（与 LunaTV 一致）
export async function PUT(request: NextRequest) {
  try {
    console.log('PUT /api/user/my-stats - 记录用户登入时间');

    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
    if (storageType === 'localstorage') {
      return NextResponse.json(
        { error: '不支持本地存储进行登入统计' },
        { status: 400 }
      );
    }

    // 从 cookie 获取用户信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { loginTime } = body;

    if (!loginTime || typeof loginTime !== 'number') {
      return NextResponse.json(
        { error: '参数错误：需要 loginTime' },
        { status: 400 }
      );
    }

    // 获取当前登入统计
    const currentStats = await db.getUserLoginStats(authInfo.username);
    const isFirstLogin = !currentStats || currentStats.loginCount === 0;

    // 更新登入统计
    await db.updateUserLoginStats(authInfo.username, loginTime, isFirstLogin);

    const newLoginCount = (currentStats?.loginCount || 0) + 1;

    console.log('用户登入统计已记录:', {
      username: authInfo.username,
      loginTime,
      isFirstLogin,
      loginCount: newLoginCount
    });

    return NextResponse.json({
      success: true,
      message: '登入时间记录成功',
      loginTime,
      loginCount: newLoginCount
    });
  } catch (error) {
    console.error('PUT /api/user/my-stats - 记录登入时间失败:', error);
    return NextResponse.json(
      {
        error: '记录登入时间失败',
        details: process.env.NODE_ENV === 'development' ? (error as Error)?.message : undefined
      },
      { status: 500 }
    );
  }
}