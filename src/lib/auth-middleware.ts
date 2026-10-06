import { NextRequest, NextResponse } from 'next/server';
import { apiError } from './api-utils';
import { resolveSession } from './auth-session';

// ─── 用户角色类型（精简：ADMIN + MEMBER）───
export type UserRole = 'ADMIN' | 'MEMBER';
export type LabRole = 'LAB_OWNER' | 'LAB_ADMIN' | 'LAB_MEMBER';
export type PlatformRole = 'PLATFORM_USER' | 'PLATFORM_ADMIN';

const ADMIN_ROLES: UserRole[] = ['ADMIN'];

export interface UserContext {
  userId: string;
  role: UserRole;
  labId?: string;
  isAdmin: boolean;
  labRole?: LabRole;
  platformRole: PlatformRole;
  isPlatformAdmin: boolean;
  status: string;
}

export type AuthResult = UserContext | NextResponse;

/**
 * 从认证 Cookie 解析并验证用户上下文（JWT 签名校验）。
 * 已废弃 x-user-id / x-user-role 请求头方案（可伪造）。
 */
export async function getUserContext(request: NextRequest): Promise<UserContext | null> {
  const session = await resolveSession(request);
  if (!session) return null;
  const membership = session.user.labMemberships.find((item) => item.lab.status === 'ACTIVE');
  const labRole = membership?.role as LabRole | undefined;
  const role: UserRole = labRole === 'LAB_OWNER' || labRole === 'LAB_ADMIN' ? 'ADMIN' : 'MEMBER';
  const platformRole = session.user.platformRole as PlatformRole;
  return {
    userId: session.user.id,
    role,
    labId: membership?.labId,
    labRole,
    platformRole,
    isPlatformAdmin: platformRole === 'PLATFORM_ADMIN',
    isAdmin: ADMIN_ROLES.includes(role),
    status: session.user.status,
  };
}

export async function requireAdmin(request: NextRequest): Promise<AuthResult> {
  const ctx = await getUserContext(request);
  if (!ctx) {
    return apiError('未登录或登录已过期，请重新登录', 401);
  }
  if (ctx.status !== 'ACTIVE') return apiError('账号尚未激活或已被停用', 403);
  if (!ctx.isAdmin) {
    return apiError('权限不足，需要管理员角色', 403);
  }
  return ctx;
}

export async function requireAuth(request: NextRequest): Promise<AuthResult> {
  const ctx = await getUserContext(request);
  if (!ctx) {
    return apiError('未登录或登录已过期，请重新登录', 401);
  }
  if (ctx.status !== 'ACTIVE') return apiError('账号尚未通过审批或已被停用', 403);
  return ctx;
}

export function isUserContext(result: AuthResult): result is UserContext {
  return !(result instanceof NextResponse);
}

// 便于需要原始 payload 的场景（如刷新令牌）
export async function requirePlatformAdmin(request: NextRequest): Promise<AuthResult> {
  const ctx = await getUserContext(request);
  if (!ctx) return apiError('未登录或登录已过期，请重新登录', 401);
  if (ctx.status !== 'ACTIVE') return apiError('账号尚未激活或已被停用', 403);
  if (!ctx.isPlatformAdmin) return apiError('需要平台管理员权限', 403);
  return ctx;
}

export async function requireLabOwner(request: NextRequest): Promise<AuthResult> {
  const ctx = await getUserContext(request);
  if (!ctx) return apiError('未登录或登录已过期，请重新登录', 401);
  if (ctx.status !== 'ACTIVE') return apiError('账号尚未激活或已被停用', 403);
  if (ctx.labRole !== 'LAB_OWNER') return apiError('需要实验室最高管理员权限', 403);
  return ctx;
}
