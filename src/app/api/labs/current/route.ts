import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, apiError, validationError } from '@/lib/api-utils';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';

export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;

  if (!authResult.labId) {
    return apiError('当前用户未分配实验室', 400);
  }

  const lab = await prisma.lab.findUnique({
    where: { id: authResult.labId },
    include: {
      _count: {
        select: { users: true, reagents: true, devices: true },
      },
    },
  });

  if (!lab) {
    return apiError('实验室不存在', 404);
  }

  return NextResponse.json({
    id: lab.id,
    name: lab.name,
    location: lab.location,
    school: lab.school,
    college: lab.college,
    description: lab.description,
    workStartTime: lab.workStartTime,
      workEndTime: lab.workEndTime,
      joinCode: lab.joinCode,
      createdAt: lab.createdAt.toISOString(),
    updatedAt: lab.updatedAt.toISOString(),
    stats: {
      memberCount: lab._count.users,
      reagentCount: lab._count.reagents,
      deviceCount: lab._count.devices,
    },
  });
});

// 更新实验室信息（仅管理员可编辑）
export const PUT = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;

  if (!authResult.isAdmin) {
    return apiError('权限不足，需要管理员角色', 403);
  }

  if (!authResult.labId) {
    return apiError('当前用户未分配实验室', 400);
  }

  const body = await request.json();
  const { name, location, school, college, description, workStartTime, workEndTime } = body ?? {};

  // 简单校验
  const errors: Record<string, string[]> = {};
  if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
    errors.name = ['实验室名称不能为空'];
  }
  if (location !== undefined && (typeof location !== 'string' || location.trim().length === 0)) {
    errors.location = ['实验室位置不能为空'];
  }
  if (school !== undefined && school !== null && typeof school !== 'string') {
    errors.school = ['学校名称需为字符串'];
  }
  if (college !== undefined && college !== null && typeof college !== 'string') {
    errors.college = ['学院名称需为字符串'];
  }
  if (description !== undefined && description !== null && typeof description !== 'string') {
    errors.description = ['实验室描述需为字符串'];
  }
  // 工作时间校验（HH:mm 格式）
  const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (workStartTime !== undefined && workStartTime !== null && workStartTime !== '' && !timeRegex.test(workStartTime)) {
    errors.workStartTime = ['工作开始时间格式应为 HH:mm'];
  }
  if (workEndTime !== undefined && workEndTime !== null && workEndTime !== '' && !timeRegex.test(workEndTime)) {
    errors.workEndTime = ['工作结束时间格式应为 HH:mm'];
  }
  if (Object.keys(errors).length > 0) return validationError(errors);

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name.trim();
  if (location !== undefined) data.location = location.trim();
  if (school !== undefined) data.school = school?.trim() || null;
  if (college !== undefined) data.college = college?.trim() || null;
  if (description !== undefined) data.description = description?.trim() || null;
  if (workStartTime !== undefined) data.workStartTime = workStartTime || null;
  if (workEndTime !== undefined) data.workEndTime = workEndTime || null;

  if (Object.keys(data).length === 0) {
    return apiError('未提供任何需要更新的字段', 400);
  }

  const lab = await prisma.lab.update({
    where: { id: authResult.labId },
    data,
    include: {
      _count: {
        select: { users: true, reagents: true, devices: true },
      },
    },
  });

  return NextResponse.json({
    id: lab.id,
    name: lab.name,
    location: lab.location,
    school: lab.school,
    college: lab.college,
    description: lab.description,
    workStartTime: lab.workStartTime,
      workEndTime: lab.workEndTime,
      joinCode: lab.joinCode,
      createdAt: lab.createdAt.toISOString(),
    updatedAt: lab.updatedAt.toISOString(),
    stats: {
      memberCount: lab._count.users,
      reagentCount: lab._count.reagents,
      deviceCount: lab._count.devices,
    },
  });
});
