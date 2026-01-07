/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    // 验证管理员权限
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || (authInfo.role !== 'admin' && authInfo.role !== 'owner')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { mode } = body; // 'init' = 带缓冲期, 'force' = 强制立即清理

    const config = await getConfig();
    const inactiveDays = config.SiteConfig.inactiveUserDays || 7;
    const cutoffTime = Date.now() - inactiveDays * 24 * 60 * 60 * 1000;
    const ownerUsername = process.env.USERNAME;

    const usersToRemove: string[] = [];
    let initializedCount = 0;

    for (const user of config.UserConfig.Users) {
      // 跳过站长和管理员
      if (user.role === 'owner' || user.role === 'admin' || user.username === ownerUsername) {
        continue;
      }

      // 使用独立的登入统计（与 LunaTV 一致）
      const loginStats = await db.getUserLoginStats(user.username);
      const lastLoginTime = loginStats?.lastLoginTime || loginStats?.lastLoginDate || loginStats?.firstLoginTime || 0;

      if (mode === 'force') {
        // 强制清理模式：无登入记录或超时都清理
        if (lastLoginTime === 0 || lastLoginTime < cutoffTime) {
          usersToRemove.push(user.username);
        }
      } else {
        // 带缓冲期模式
        if (lastLoginTime === 0) {
          // 为没有登入记录的用户初始化登入统计
          const now = Date.now();
          await db.updateUserLoginStats(user.username, now, true);
          initializedCount++;
        } else if (lastLoginTime < cutoffTime) {
          usersToRemove.push(user.username);
        }
      }
    }

    // 执行清理
    if (usersToRemove.length > 0) {
      config.UserConfig.Users = config.UserConfig.Users.filter(
        u => !usersToRemove.includes(u.username)
      );
      await db.saveAdminConfig(config);

      for (const username of usersToRemove) {
        try {
          await db.deleteUser(username);
        } catch (err) {
          console.error(`清理用户数据失败 (${username}):`, err);
        }
      }
    }

    return NextResponse.json({
      success: true,
      mode,
      removedCount: usersToRemove.length,
      initializedCount,
      message: mode === 'force' 
        ? `强制清理完成，共删除 ${usersToRemove.length} 个用户`
        : `清理完成，删除 ${usersToRemove.length} 个用户，初始化 ${initializedCount} 个用户（开始缓冲期）`,
    });
  } catch (error) {
    console.error('清理用户失败:', error);
    return NextResponse.json(
      { error: '清理失败' },
      { status: 500 }
    );
  }
}
