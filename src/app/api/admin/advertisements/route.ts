/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { Advertisement } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/advertisements
 * 获取所有广告（管理后台）
 */
export async function GET(req: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  
  if (storageType === 'localstorage') {
    return NextResponse.json(
      { error: '不支持本地存储模式' },
      { status: 400 }
    );
  }

  try {
    const authInfo = getAuthInfoFromCookie(req);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 仅站长和管理员可访问
    if (authInfo.role !== 'owner' && authInfo.role !== 'admin') {
      return NextResponse.json({ error: '权限不足' }, { status: 403 });
    }

    const advertisements = await db.getAllAdvertisements();
    
    console.log('数据库返回的广告:', advertisements);

    return NextResponse.json(
      { advertisements },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    console.error('获取广告列表失败:', error);
    return NextResponse.json(
      { error: '获取广告列表失败' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/advertisements
 * 创建或更新广告
 */
export async function POST(req: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  
  if (storageType === 'localstorage') {
    return NextResponse.json(
      { error: '不支持本地存储模式' },
      { status: 400 }
    );
  }

  try {
    const authInfo = getAuthInfoFromCookie(req);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 仅站长和管理员可访问
    if (authInfo.role !== 'owner' && authInfo.role !== 'admin') {
      return NextResponse.json({ error: '权限不足' }, { status: 403 });
    }

    const body = await req.json();
    const { action, advertisement } = body;

    if (action === 'create') {
      // 创建广告
      const newAd: Advertisement = {
        id: `ad_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        position: advertisement.position,
        type: advertisement.type,
        title: advertisement.title,
        materialUrl: advertisement.materialUrl,
        clickUrl: advertisement.clickUrl,
        width: advertisement.width,
        height: advertisement.height,
        startDate: advertisement.startDate,
        endDate: advertisement.endDate,
        enabled: advertisement.enabled !== false,
        priority: advertisement.priority || 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await db.createAdvertisement(newAd);

      return NextResponse.json({
        success: true,
        message: '广告创建成功',
        advertisement: newAd,
      });
    } else if (action === 'update') {
      // 更新广告
      const { id, ...updates } = advertisement;
      
      if (!id) {
        return NextResponse.json(
          { error: '缺少广告ID' },
          { status: 400 }
        );
      }

      await db.updateAdvertisement(id, updates);

      return NextResponse.json({
        success: true,
        message: '广告更新成功',
      });
    } else if (action === 'delete') {
      // 删除广告
      const { id } = advertisement;
      
      if (!id) {
        return NextResponse.json(
          { error: '缺少广告ID' },
          { status: 400 }
        );
      }

      await db.deleteAdvertisement(id);

      return NextResponse.json({
        success: true,
        message: '广告删除成功',
      });
    } else {
      return NextResponse.json(
        { error: '无效的操作' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('广告操作失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '操作失败' },
      { status: 500 }
    );
  }
}
