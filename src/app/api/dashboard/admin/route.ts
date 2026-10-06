import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { withErrorHandler } from '@/lib/api-utils';

export const GET = withErrorHandler(async (request: NextRequest) => {
  const ctx = await requireAdmin(request);
  if (!isUserContext(ctx)) return ctx;
  if (!ctx.labId) return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [
    pendingRequisitions, pendingReservations, pendingDocuments, pendingJoinRequests,
    pendingTaskChanges, pendingProjectDocuments, highRiskApprovals,
    todayRequisitionReviews, todayReservationReviews, todayJoinReviews, todayTaskReviews, todayDocumentReviews,
    riskEventCount, expiringCount, expiredCount, lowStockRows, recentRequisitions, recentJoinRequests,
  ] = await Promise.all([
    prisma.requisition.count({ where: { labId: ctx.labId, status: { in: ['PENDING', 'NEEDS_CONFIRM'] } } }),
    prisma.deviceReservation.count({ where: { device: { labId: ctx.labId }, status: 'PENDING' } }),
    prisma.document.count({ where: { labId: ctx.labId, status: 'PENDING' } }),
    prisma.joinRequest.count({ where: { labId: ctx.labId, status: 'PENDING' } }),
    prisma.projectTaskChangeRequest.count({ where: { project: { labId: ctx.labId, deletedAt: null }, status: 'PENDING' } }),
    prisma.projectDocumentVersion.count({ where: { document: { project: { labId: ctx.labId, deletedAt: null } }, status: 'PENDING_REVIEW' } }),
    prisma.requisition.count({ where: { labId: ctx.labId, status: { in: ['PENDING', 'NEEDS_CONFIRM'] }, reagent: { OR: [{ riskLevel: 'HIGH' }, { isControlled: true }, { isHazardous: true }] } } }),
    prisma.requisition.count({ where: { labId: ctx.labId, reviewedAt: { gte: startOfDay } } }),
    prisma.deviceReservation.count({ where: { device: { labId: ctx.labId }, reviewedAt: { gte: startOfDay } } }),
    prisma.joinRequest.count({ where: { labId: ctx.labId, reviewedAt: { gte: startOfDay } } }),
    prisma.projectTaskChangeRequest.count({ where: { project: { labId: ctx.labId }, reviewedAt: { gte: startOfDay } } }),
    prisma.projectDocumentReview.count({ where: { version: { document: { project: { labId: ctx.labId } } }, createdAt: { gte: startOfDay } } }),
    prisma.riskEvent.count({ where: { labId: ctx.labId, isResolved: false } }),
    prisma.reagent.count({ where: { labId: ctx.labId, expiryDate: { gte: now, lte: thirtyDaysLater } } }),
    prisma.reagent.count({ where: { labId: ctx.labId, expiryDate: { lt: now } } }),
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) as count FROM Reagent WHERE labId = ${ctx.labId} AND stockQuantity <= minStock`,
    prisma.requisition.findMany({ where: { labId: ctx.labId }, take: 5, orderBy: { createdAt: 'desc' }, include: { reagent: { select: { name: true } }, applicant: { select: { name: true } } } }),
    prisma.joinRequest.findMany({ where: { labId: ctx.labId }, take: 4, orderBy: { createdAt: 'desc' }, include: { user: { select: { name: true } } } }),
  ]);

  const groups = [
    { key: 'requisitions', label: '试剂领用', count: pendingRequisitions, href: '/admin/review' },
    { key: 'reservations', label: '设备预约', count: pendingReservations, href: '/admin/review' },
    { key: 'documents', label: '票据确认', count: pendingDocuments, href: '/admin/reagents' },
    { key: 'join', label: '入组申请', count: pendingJoinRequests, href: '/admin/members' },
    { key: 'taskChanges', label: '阶段任务修改', count: pendingTaskChanges, href: '/admin/knowledge' },
    { key: 'projectDocuments', label: '课题文档', count: pendingProjectDocuments, href: '/admin/knowledge' },
  ];
  const recentActivities = [
    ...recentRequisitions.map((item) => ({ id: item.id, type: '试剂申请', detail: `${item.applicant.name} · ${item.reagent.name}`, status: item.status, createdAt: item.createdAt.toISOString() })),
    ...recentJoinRequests.map((item) => ({ id: item.id, type: '入组申请', detail: item.user.name, status: item.status, createdAt: item.createdAt.toISOString() })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 7);

  return NextResponse.json({
    pendingTotal: groups.reduce((sum, group) => sum + group.count, 0),
    highRiskApprovals,
    pendingJoinRequests,
    todayProcessed: todayRequisitionReviews + todayReservationReviews + todayJoinReviews + todayTaskReviews + todayDocumentReviews,
    approvalGroups: groups,
    safety: { riskEventCount, expiringCount, expiredCount, lowStockCount: Number(lowStockRows[0]?.count || 0) },
    recentActivities,
  });
});

