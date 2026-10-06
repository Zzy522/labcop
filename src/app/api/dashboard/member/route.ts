import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { withErrorHandler } from '@/lib/api-utils';
import { pendingReceiptItemCount } from '@/lib/receipt-ocr';

export const GET = withErrorHandler(async (request: NextRequest) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  if (!ctx.labId) return NextResponse.json({ error: '尚未加入实验室' }, { status: 403 });

  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const managerProjects = await prisma.projectMember.findMany({
    where: { userId: ctx.userId, role: 'MANAGER', project: { deletedAt: null } },
    select: { projectId: true },
  });
  const managerProjectIds = managerProjects.map((item) => item.projectId);

  const [
    pendingApplications,
    todayReservations,
    activeProjectTasks,
    overdueProjectTasks,
    unreadNotifications,
    inspections,
    ownChangeRequests,
    managerChangeReviews,
    managerDocumentReviews,
    upcomingReservations,
    tasks,
    notifications,
    ocrDocuments,
  ] = await Promise.all([
    prisma.requisition.count({ where: { applicantId: ctx.userId, status: { in: ['PENDING', 'NEEDS_CONFIRM'] } } }),
    prisma.deviceReservation.count({ where: { userId: ctx.userId, startTime: { gte: now, lt: tomorrow }, status: { in: ['APPROVED', 'ACTIVE'] } } }),
    prisma.projectPhaseTask.count({ where: { deletedAt: null, assignees: { some: { userId: ctx.userId } }, status: { in: ['PLANNED', 'IN_PROGRESS', 'BLOCKED'] } } }),
    prisma.projectPhaseTask.count({ where: { deletedAt: null, assignees: { some: { userId: ctx.userId } }, dueDate: { lt: now }, status: { notIn: ['COMPLETED', 'CANCELLED'] } } }),
    prisma.notification.count({ where: { recipientId: ctx.userId, readAt: null } }),
    prisma.inspectionAssignment.count({ where: { assigneeId: ctx.userId, status: { in: ['ASSIGNED', 'REJECTED', 'OVERDUE'] } } }),
    prisma.projectTaskChangeRequest.count({ where: { requesterId: ctx.userId, status: 'PENDING' } }),
    managerProjectIds.length
      ? prisma.projectTaskChangeRequest.count({ where: { projectId: { in: managerProjectIds }, status: 'PENDING' } })
      : 0,
    managerProjectIds.length
      ? prisma.projectDocumentVersion.count({ where: { document: { projectId: { in: managerProjectIds } }, status: 'PENDING_REVIEW' } })
      : 0,
    prisma.deviceReservation.findMany({
      where: { userId: ctx.userId, startTime: { gte: now }, status: { in: ['APPROVED', 'ACTIVE', 'PENDING'] } },
      take: 4,
      orderBy: { startTime: 'asc' },
      include: { device: { select: { name: true } } },
    }),
    prisma.projectPhaseTask.findMany({
      where: { deletedAt: null, assignees: { some: { userId: ctx.userId } }, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      take: 6,
      orderBy: [{ dueDate: 'asc' }, { updatedAt: 'desc' }],
      include: { project: { select: { id: true, name: true } } },
    }),
    prisma.notification.findMany({
      where: { recipientId: ctx.userId, readAt: null },
      take: 5,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.document.findMany({
      where: { uploadedById: ctx.userId, labId: ctx.labId, processingMode: 'OCR', status: { in: ['QUEUED', 'PROCESSING', 'PENDING', 'REJECTED'] } },
      select: { status: true, recognitionResult: true },
      take: 50,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const timeline = [
    ...upcomingReservations.map((item) => ({
      id: `reservation-${item.id}`,
      type: '设备预约',
      title: item.device.name,
      time: item.startTime.toISOString(),
      href: '/user/equipment-apply',
      status: item.status,
    })),
    ...tasks.filter((task) => task.dueDate).map((task) => ({
      id: `task-${task.id}`,
      type: '课题任务',
      title: `${task.project.name} · ${task.name}`,
      time: task.dueDate!.toISOString(),
      href: '/user/knowledge',
      status: task.status,
    })),
    ...notifications.map((item) => ({
      id: `notification-${item.id}`,
      type: '通知',
      title: item.title,
      time: item.createdAt.toISOString(),
      href: item.actionUrl || '/user/notifications',
      status: item.priority,
    })),
  ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()).slice(0, 10);

  return NextResponse.json({
    pendingApplications,
    todayReservations,
    activeProjectTasks,
    overdueProjectTasks,
    unreadNotifications,
    inspectionTasks: inspections,
    ownChangeRequests,
    isProjectManager: managerProjectIds.length > 0,
    managerProjectCount: managerProjectIds.length,
    managerPendingReviews: managerChangeReviews + managerDocumentReviews,
    managerChangeReviews,
    managerDocumentReviews,
    ocrQueue: {
      queued: ocrDocuments.filter((document) => document.status === 'QUEUED').length,
      processing: ocrDocuments.filter((document) => document.status === 'PROCESSING').length,
      failed: ocrDocuments.filter((document) => document.status === 'REJECTED').length,
      pendingItems: ocrDocuments.reduce((sum, document) => sum + pendingReceiptItemCount(document.recognitionResult), 0),
    },
    projectTasks: tasks.map((task) => ({
      ...task,
      dueDate: task.dueDate?.toISOString() ?? null,
      updatedAt: task.updatedAt.toISOString(),
    })),
    timeline,
  });
});
