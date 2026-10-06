import { prisma } from '@/lib/prisma';

/**
 * 待办服务
 * - 待办由系统在特定事件下生成（值日巡查/设备归位/试剂归还）
 * - 也支持管理员手动派发（OTHER 类型）
 * - 多人接收场景（设备归位）任一人完成即关闭
 */

export type TodoType =
  | 'SAFETY_INSPECTION'
  | 'DEVICE_RETURN'
  | 'REAGENT_RETURN'
  | 'OTHER';

/** 查询当前用户的待办列表 */
export async function listMyTodos(userId: string, labId: string) {
  // 先同步生成今天的派生待办（值日巡查 / 试剂归还）
  await spawnDerivedTodos(userId, labId);

  return prisma.todo.findMany({
    where: { assigneeId: userId, labId },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: {
      assigner: { select: { id: true, name: true } },
    },
  });
}

/**
 * 派生待办：
 * 1. 值日巡查（SAFETY_INSPECTION）：今天有派给本人的巡检任务 → 生成一条总体巡查待办
 * 2. 试剂归还（REAGENT_RETURN）：今天本人有已批准的试剂领用/申请 → 生成一条归还提醒
 * 3. 设备归位（DEVICE_RETURN）：本人是预约人且预约已过结束时间但未生成归位待办 → 生成
 */
async function spawnDerivedTodos(userId: string, labId: string): Promise<void> {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  // 1. 值日巡查：今天有派给本人的巡检任务
  const todayInspections = await prisma.inspectionAssignment.findMany({
    where: {
      assigneeId: userId,
      labId,
      dueDate: { gte: todayStart, lte: todayEnd },
      status: { in: ['ASSIGNED', 'SUBMITTED'] },
    },
    select: { id: true, title: true },
  });
  for (const ins of todayInspections) {
    await ensureTodo({
      labId,
      assigneeId: userId,
      type: 'SAFETY_INSPECTION',
      title: '总体巡查',
      description: `今日值日巡查任务：${ins.title}（点击"已查"完成）`,
      relatedId: ins.id,
    });
  }

  // 2. 试剂归还：今天本人已批准的领用/申请
  const todayRequisitions = await prisma.requisition.findMany({
    where: {
      applicantId: userId,
      status: 'APPROVED',
      createdAt: { gte: todayStart, lte: todayEnd },
    },
    include: { reagent: { select: { name: true, unit: true } } },
  });
  for (const req of todayRequisitions) {
    await ensureTodo({
      labId,
      assigneeId: userId,
      type: 'REAGENT_RETURN',
      title: '试剂归还提醒',
      description: `您今日领用/申请的「${req.reagent.name}」(${req.quantity}${req.reagent.unit ?? ''})，使用完毕请及时归还或妥善处置`,
      relatedId: req.id,
    });
  }

  // 3. 设备归位：本人预约且已过结束时间、设备可能未归位
  // 简化：只对预约人本人生成待办（值日生侧可通过总体巡查覆盖）
  const overdueReservations = await prisma.deviceReservation.findMany({
    where: {
      userId,
      endTime: { lt: now },
      status: { in: ['APPROVED', 'ACTIVE', 'COMPLETED'] },
    },
    include: { device: { select: { name: true, location: true } } },
  });
  for (const res of overdueReservations) {
    await ensureTodo({
      labId,
      assigneeId: userId,
      type: 'DEVICE_RETURN',
      title: '设备归位检查',
      description: `您预约的设备「${res.device.name}」(${res.device.location ?? '未知位置'})使用时段已结束，请确认设备已归位并恢复可用状态`,
      relatedId: res.id,
    });
  }
}

/** 幂等创建待办：同一 relatedId + type + assigneeId 仅创建一条 PENDING 待办 */
async function ensureTodo(input: {
  labId: string;
  assigneeId: string;
  type: TodoType;
  title: string;
  description: string;
  relatedId: string;
}): Promise<void> {
  const existing = await prisma.todo.findFirst({
    where: {
      assigneeId: input.assigneeId,
      type: input.type,
      relatedId: input.relatedId,
    },
    select: { id: true, status: true },
  });
  if (existing) return; // 已存在（无论 PENDING/DONE）不重复创建
  await prisma.todo.create({
    data: {
      labId: input.labId,
      assigneeId: input.assigneeId,
      type: input.type,
      title: input.title,
      description: input.description,
      relatedId: input.relatedId,
      status: 'PENDING',
    },
  });
}

/** 完成待办（幂等，重复完成返回当前状态） */
export async function completeTodo(
  todoId: string,
  userId: string
) {
  const todo = await prisma.todo.findUnique({ where: { id: todoId } });
  if (!todo) throw new Error('待办不存在');
  if (todo.assigneeId !== userId) {
    // 设备归位场景：值日生可代为完成（同实验室成员即可）
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { labId: true, role: true },
    });
    if (!user || user.labId !== todo.labId) {
      throw new Error('无权操作此待办');
    }
  }
  if (todo.status === 'DONE') return todo;
  return prisma.todo.update({
    where: { id: todoId },
    data: {
      status: 'DONE',
      completedById: userId,
      completedAt: new Date(),
    },
  });
}
