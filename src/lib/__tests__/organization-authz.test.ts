import { describe, expect, it } from 'vitest';
import { canAccessLab, canReviewApplication, publicRegistrationRole } from '@/lib/organization-authz';

const ownerA = { userId: 'owner-a', labId: 'lab-a', labRole: 'LAB_OWNER', platformRole: 'PLATFORM_USER', status: 'ACTIVE' };
const adminA = { userId: 'admin-a', labId: 'lab-a', labRole: 'LAB_ADMIN', platformRole: 'PLATFORM_USER', status: 'ACTIVE' };
const platform = { userId: 'platform', platformRole: 'PLATFORM_ADMIN', status: 'ACTIVE' };

describe('组织审批边界', () => {
  it('只有平台管理员能审批新实验室与首位 LAB_OWNER', () => {
    const application = { applicationType: 'CREATE_LAB', targetLabId: null };
    expect(canReviewApplication(platform, application)).toBe(true);
    expect(canReviewApplication(ownerA, application)).toBe(false);
  });
  it('目标实验室 LAB_OWNER 或平台管理员能审批加入申请', () => {
    const application = { applicationType: 'JOIN_LAB', targetLabId: 'lab-a' };
    expect(canReviewApplication(ownerA, application)).toBe(true);
    expect(canReviewApplication(adminA, application)).toBe(false);
    expect(canReviewApplication({ ...ownerA, labId: 'lab-b' }, application)).toBe(false);
    expect(canReviewApplication(platform, application)).toBe(true);
  });
  it('停用账号即使曾是 owner 也不能审批', () => {
    expect(canReviewApplication({ ...ownerA, status: 'SUSPENDED' }, { applicationType: 'JOIN_LAB', targetLabId: 'lab-a' })).toBe(false);
  });
});

describe('跨实验室隔离', () => {
  it('拒绝访问其他实验室资源', () => {
    expect(canAccessLab(ownerA, 'lab-a')).toBe(true);
    expect(canAccessLab(ownerA, 'lab-b')).toBe(false);
  });
  it('公开注册永远不会产生平台或学院角色', () => {
    expect(publicRegistrationRole('LAB_ADMIN', true)).toBe('LAB_OWNER');
    expect(publicRegistrationRole('LAB_ADMIN', false)).toBe('LAB_ADMIN');
    expect(publicRegistrationRole('LAB_MEMBER', false)).toBe('LAB_MEMBER');
  });
});
