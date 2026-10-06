'use client';

import { useState } from 'react';
import {
  Loader2,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  FlaskConical,
  ListTodo,
  Megaphone,
  Check,
  Inbox,
  ShieldAlert,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { authFetch } from '@/lib/auth-fetch';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';

// ─── 类型定义 ───
type TodoType = 'SAFETY_INSPECTION' | 'DEVICE_RETURN' | 'REAGENT_RETURN' | 'OTHER';

interface TodoItem {
  id: string;
  type: TodoType;
  title: string;
  description: string | null;
  status: 'PENDING' | 'DONE';
  relatedId: string | null;
  completedById: string | null;
  completedAt: string | null;
  createdAt: string;
  assigner?: { id: string; name: string } | null;
}

interface AnnouncementItem {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  llmOptimized: boolean;
  isRead: boolean;
  readAt: string | null;
  createdBy: { id: string; name: string };
}

interface SystemNotificationItem {
  id: string;
  type: string;
  title: string;
  content: string;
  priority: string;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

// ─── 待办类型配置 ───
const TODO_TYPE_CONFIG: Record<TodoType, {
  label: string;
  icon: typeof ClipboardCheck;
  iconBgClass: string;
  iconTextClass: string;
  badgeClass: string;
  actionLabel: string;
}> = {
  SAFETY_INSPECTION: {
    label: '安全检查',
    icon: ClipboardCheck,
    iconBgClass: 'bg-teal-100',
    iconTextClass: 'text-teal-600',
    badgeClass: 'border-teal-500 text-teal-700 bg-teal-50',
    actionLabel: '已查',
  },
  DEVICE_RETURN: {
    label: '设备归位',
    icon: Cpu,
    iconBgClass: 'bg-indigo-100',
    iconTextClass: 'text-indigo-600',
    badgeClass: 'border-indigo-500 text-indigo-700 bg-indigo-50',
    actionLabel: '已查',
  },
  REAGENT_RETURN: {
    label: '试剂归还',
    icon: FlaskConical,
    iconBgClass: 'bg-amber-100',
    iconTextClass: 'text-amber-600',
    badgeClass: 'border-amber-500 text-amber-700 bg-amber-50',
    actionLabel: '归还',
  },
  OTHER: {
    label: '其他事项',
    icon: ListTodo,
    iconBgClass: 'bg-sky-100',
    iconTextClass: 'text-sky-600',
    badgeClass: 'border-sky-500 text-sky-700 bg-sky-50',
    actionLabel: '完成',
  },
};

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  if (diffHour < 24) return `${diffHour}小时前`;
  if (diffDay < 7) return `${diffDay}天前`;
  return format(date, 'MM-dd');
}

// ─── 数据获取 ───
async function fetchTodos(): Promise<TodoItem[]> {
  const res = await authFetch('/api/todos');
  if (!res.ok) throw new Error('获取待办失败');
  const data = await res.json();
  return data.data ?? [];
}

async function fetchAnnouncements(): Promise<AnnouncementItem[]> {
  const res = await authFetch('/api/announcements');
  if (!res.ok) throw new Error('获取通告失败');
  const data = await res.json();
  return data.data ?? [];
}

async function fetchSystemNotifications(): Promise<SystemNotificationItem[]> {
  const res = await authFetch('/api/notifications');
  if (!res.ok) throw new Error('获取系统通知失败');
  const data = await res.json();
  return data.data ?? [];
}

// ─── 主页面 ───
export default function NotificationsPage() {
  const [activeTab, setActiveTab] = useState<'todos' | 'announcements' | 'system'>('todos');

  const { data: todos = [], isLoading: todosLoading } = useQuery({
    queryKey: ['user-todos'],
    queryFn: fetchTodos,
  });
  const { data: announcements = [], isLoading: annLoading } = useQuery({
    queryKey: ['user-announcements'],
    queryFn: fetchAnnouncements,
  });
  const { data: systemNotifications = [], isLoading: systemLoading } = useQuery({
    queryKey: ['user-system-notifications'],
    queryFn: fetchSystemNotifications,
  });

  const pendingTodos = todos.filter((t) => t.status === 'PENDING');
  const unreadAnnouncements = announcements.filter((a) => !a.isRead);
  const unreadSystem = systemNotifications.filter((item) => !item.readAt);

  return (
    <div className="space-y-6">
      {/* Tab 导航 */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        <TabButton
          active={activeTab === 'todos'}
          onClick={() => setActiveTab('todos')}
          icon={ListTodo}
          label="待办事项"
          count={pendingTodos.length}
        />
        <TabButton
          active={activeTab === 'system'}
          onClick={() => setActiveTab('system')}
          icon={ShieldAlert}
          label="系统通知"
          count={unreadSystem.length}
        />
        <TabButton
          active={activeTab === 'announcements'}
          onClick={() => setActiveTab('announcements')}
          icon={Megaphone}
          label="通告"
          count={unreadAnnouncements.length}
        />
      </div>

      {/* Tab 内容 */}
      {activeTab === 'todos' && (
        <TodosTab todos={todos} isLoading={todosLoading} />
      )}
      {activeTab === 'announcements' && (
        <AnnouncementsTab announcements={announcements} isLoading={annLoading} />
      )}
      {activeTab === 'system' && (
        <SystemNotificationsTab notifications={systemNotifications} isLoading={systemLoading} />
      )}
    </div>
  );
}

function SystemNotificationsTab({ notifications, isLoading }: { notifications: SystemNotificationItem[]; isLoading: boolean }) {
  const queryClient = useQueryClient();
  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const response = await authFetch(`/api/notifications/${id}/read`, { method: 'POST' });
      if (!response.ok && response.status !== 404) throw new Error('标记已读失败');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['user-system-notifications'] }),
  });
  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="size-8 animate-spin text-emerald-500"/></div>;
  if (!notifications.length) return <Card className="border-0 shadow-sm"><CardContent className="flex flex-col items-center py-16"><Inbox className="size-12 text-gray-300"/><p className="mt-4 text-gray-500">暂无系统通知</p></CardContent></Card>;
  return <div className="space-y-3">{notifications.map((item)=><Card key={item.id} className={cn('border-0 shadow-sm',!item.readAt&&'border-l-4 border-l-amber-500 bg-amber-50/30')}><CardContent className="flex items-start gap-3 p-4"><div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700"><ShieldAlert className="size-5"/></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-gray-900">{item.title}</p><Badge variant="outline" className="text-[10px]">{item.priority}</Badge></div><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-gray-600">{item.content}</p><p className="mt-2 text-xs text-gray-400">{new Date(item.createdAt).toLocaleString('zh-CN')}</p></div>{!item.readAt&&<Button size="sm" variant="outline" onClick={()=>markRead.mutate(item.id)}>设为已读</Button>}</CardContent></Card>)}</div>;
}

// ─── Tab 按钮 ───
function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all duration-200 border-b-2 -mb-px',
        active
          ? 'border-emerald-500 text-emerald-600'
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
      )}
    >
      <Icon className="size-4" />
      {label}
      {count > 0 && (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[10px] font-semibold text-white">
          {count}
        </span>
      )}
    </button>
  );
}

// ─── 待办事项 Tab ───
function TodosTab({ todos, isLoading }: { todos: TodoItem[]; isLoading: boolean }) {
  const queryClient = useQueryClient();

  const completeMutation = useMutation({
    mutationFn: async (todoId: string) => {
      const res = await authFetch(`/api/todos/${todoId}/complete`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: '操作失败' }));
        throw new Error(data.error || '操作失败');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-todos'] });
    },
  });

  // 按类型分组
  const grouped: Record<TodoType, TodoItem[]> = {
    SAFETY_INSPECTION: [],
    DEVICE_RETURN: [],
    REAGENT_RETURN: [],
    OTHER: [],
  };
  for (const t of todos) {
    if (grouped[t.type]) grouped[t.type].push(t);
  }

  const typeOrder: TodoType[] = ['SAFETY_INSPECTION', 'DEVICE_RETURN', 'REAGENT_RETURN', 'OTHER'];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (todos.length === 0) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="flex flex-col items-center justify-center py-16">
          <div className="flex size-16 items-center justify-center rounded-full bg-gray-100">
            <Inbox className="size-8 text-gray-400" />
          </div>
          <p className="mt-4 text-base font-medium text-gray-600">暂无待办事项</p>
          <p className="mt-1 text-sm text-gray-400">值日巡查、设备归位、试剂归还等任务将在这里显示</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {typeOrder.map((type) => {
        const items = grouped[type];
        if (items.length === 0) return null;
        const config = TODO_TYPE_CONFIG[type];
        const Icon = config.icon;
        const pendingCount = items.filter((t) => t.status === 'PENDING').length;
        return (
          <div key={type}>
            <div className="mb-2 flex items-center gap-2">
              <Icon className={cn('size-4', config.iconTextClass)} />
              <h3 className="text-sm font-semibold text-gray-700">{config.label}</h3>
              <span className="text-xs text-gray-400">
                共 {items.length} 条{pendingCount > 0 && `· ${pendingCount} 条待处理`}
              </span>
            </div>
            <div className="space-y-2">
              {items.map((todo) => (
                <TodoCard
                  key={todo.id}
                  todo={todo}
                  onComplete={() => completeMutation.mutate(todo.id)}
                  isCompleting={completeMutation.isPending}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── 待办卡片 ───
function TodoCard({
  todo,
  onComplete,
  isCompleting,
}: {
  todo: TodoItem;
  onComplete: () => void;
  isCompleting: boolean;
}) {
  const config = TODO_TYPE_CONFIG[todo.type];
  const Icon = config.icon;
  const isDone = todo.status === 'DONE';

  return (
    <Card className={cn('border-0 shadow-sm transition-colors', isDone && 'opacity-60')}>
      <CardContent className="flex items-start gap-3 p-4">
        <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', config.iconBgClass, config.iconTextClass)}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900">{todo.title}</span>
            <Badge variant="outline" className={cn('text-[10px]', config.badgeClass)}>
              {config.label}
            </Badge>
            {isDone && (
              <Badge variant="outline" className="text-[10px] border-gray-300 text-gray-500 bg-gray-50">
                <CheckCircle2 className="mr-0.5 size-2.5" />
                已完成
              </Badge>
            )}
          </div>
          {todo.description && (
            <p className="mt-1 text-xs text-gray-600 whitespace-pre-wrap">{todo.description}</p>
          )}
          <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-400">
            <span>{formatTime(todo.createdAt)}</span>
            {todo.assigner && (
              <span>派发人：{todo.assigner.name}</span>
            )}
            {isDone && todo.completedAt && (
              <span>完成于 {formatTime(todo.completedAt)}</span>
            )}
          </div>
        </div>
        {!isDone && (
          <Button
            size="sm"
            onClick={onComplete}
            disabled={isCompleting}
            className="h-7 shrink-0 px-3 text-xs"
          >
            {isCompleting ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Check className="size-3" />
            )}
            {config.actionLabel}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ─── 通告 Tab ───
function AnnouncementsTab({
  announcements,
  isLoading,
}: {
  announcements: AnnouncementItem[];
  isLoading: boolean;
}) {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const markReadMutation = useMutation({
    mutationFn: async (announcementId: string) => {
      const res = await authFetch(`/api/announcements/${announcementId}/read`, { method: 'POST' });
      if (!res.ok) throw new Error('标记已读失败');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-announcements'] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (announcements.length === 0) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="flex flex-col items-center justify-center py-16">
          <div className="flex size-16 items-center justify-center rounded-full bg-gray-100">
            <Megaphone className="size-8 text-gray-400" />
          </div>
          <p className="mt-4 text-base font-medium text-gray-600">暂无通告</p>
          <p className="mt-1 text-sm text-gray-400">实验室管理员发布的通告将在这里显示</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {announcements.map((ann) => {
        const isExpanded = expandedId === ann.id;
        return (
          <Card
            key={ann.id}
            className={cn(
              'border-0 shadow-sm transition-colors cursor-pointer',
              !ann.isRead && 'border-l-4 border-l-emerald-500 bg-emerald-50/30'
            )}
            onClick={() => {
              setExpandedId(isExpanded ? null : ann.id);
              if (!ann.isRead) markReadMutation.mutate(ann.id);
            }}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-cyan-100 text-cyan-600">
                  <Megaphone className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900">{ann.title}</span>
                    {ann.llmOptimized && (
                      <Badge variant="outline" className="text-[10px] border-violet-300 text-violet-600 bg-violet-50">
                        AI 优化
                      </Badge>
                    )}
                    {!ann.isRead ? (
                      <span className="size-2 rounded-full bg-emerald-500" />
                    ) : (
                      <Badge variant="outline" className="text-[10px] border-gray-300 text-gray-500 bg-gray-50">
                        <Check className="mr-0.5 size-2.5" />
                        已读
                      </Badge>
                    )}
                  </div>
                  <p
                    className={cn(
                      'mt-1 text-xs text-gray-600 whitespace-pre-wrap',
                      !isExpanded && 'line-clamp-2'
                    )}
                  >
                    {ann.content}
                  </p>
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-400">
                    <span>发布：{ann.createdBy.name}</span>
                    <span>{formatTime(ann.createdAt)}</span>
                    {ann.isRead && ann.readAt && (
                      <span>已读于 {formatTime(ann.readAt)}</span>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
