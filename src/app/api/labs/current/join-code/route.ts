import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { generateJoinCode } from '@/lib/join-code';

/**
 * POST /api/labs/current/join-code
 * 管理员重置本实验室的加入码（旧码失效，生成新码）。
 * 用于分享给实验员凭码申请加入。
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;

  if (!authResult.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 400 });
  }

  // 生成唯一 joinCode（重试避免冲突）
  let code = generateJoinCode();
  for (let tries = 0; tries < 5; tries++) {
    const dup = await prisma.lab.findFirst({ where: { joinCode: code } });
    if (!dup) break;
    code = generateJoinCode();
  }

  await prisma.lab.update({
    where: { id: authResult.labId },
    data: { joinCode: code },
  });

  return NextResponse.json({ data: { joinCode: code } });
});
