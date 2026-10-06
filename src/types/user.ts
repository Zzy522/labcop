// 角色精简：仅保留 ADMIN（管理员+安全员统一）和 MEMBER（实验员）
export type UserRole = 'ADMIN' | 'MEMBER';
export type LabRole = 'LAB_OWNER' | 'LAB_ADMIN' | 'LAB_MEMBER';
export type PlatformRole = 'PLATFORM_USER' | 'PLATFORM_ADMIN';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  labRole?: LabRole | null;
  platformRole?: PlatformRole;
  status?: string;
  labId: string | null;
  labName?: string;
  emailVerified?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: '管理员',
  MEMBER: '实验员',
};
