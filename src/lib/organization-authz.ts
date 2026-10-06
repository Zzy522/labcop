export type OrganizationContext = { userId: string; labId?: string; labRole?: string; platformRole?: string; status: string };

export function canReviewApplication(ctx: OrganizationContext, application: { applicationType: string; targetLabId: string | null }): boolean {
  if (ctx.status !== 'ACTIVE') return false;
  if (ctx.platformRole === 'PLATFORM_ADMIN') {
    return application.applicationType === 'CREATE_LAB' || application.applicationType === 'JOIN_LAB';
  }
  if (application.applicationType === 'CREATE_LAB') return false;
  return application.applicationType === 'JOIN_LAB' && ctx.labRole === 'LAB_OWNER' && Boolean(ctx.labId) && application.targetLabId === ctx.labId;
}

export function canAccessLab(ctx: OrganizationContext, targetLabId: string): boolean {
  return ctx.status === 'ACTIVE' && Boolean(ctx.labId) && ctx.labId === targetLabId;
}

export function publicRegistrationRole(accountType: 'LAB_ADMIN' | 'LAB_MEMBER', createsLab: boolean): 'LAB_OWNER' | 'LAB_ADMIN' | 'LAB_MEMBER' {
  if (accountType === 'LAB_MEMBER') return 'LAB_MEMBER';
  return createsLab ? 'LAB_OWNER' : 'LAB_ADMIN';
}
