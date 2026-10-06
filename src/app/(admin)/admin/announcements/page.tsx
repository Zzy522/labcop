'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Megaphone,
  Plus,
  Loader2,
  Edit3,
  Trash2,
  Eye,
  X,
  Sparkles,
  Send,
  Clock,
  RefreshCw,
  CheckCircle2,
  Users,
  ShieldAlert,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { authFetch } from '@/lib/auth-fetch';
import { format } from 'date-fns';
import { AlertsSection } from '@/components/admin/alerts-section';

// ─── 类型定义 ───
type AnnouncementStatus = 'DRAFT' | 'PUBLISHED' | 'SCHEDULED';
type RecurringPattern = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';

interface AdminAnnouncement {
  id: string;
  title: string;
  content: string;
  status: AnnouncementStatus;
  scheduledAt: string | null;
  isRecurring: boolean;
  recurringPattern: RecurringPattern;
  recurringTime: string | null;
  recurringDayOfWeek: number | null;
  recurringDayOfMonth: number | null;
  llmOptimized: boolean;
  createdAt: string;
  createdBy: { id: string; name: string };
  _count?: { reads: number };
}

interface ReaderInfo {
  userId: string;
  userName: string;
  userEmail: string;
  readAt?: string;
  role?: string;
}

interface ReadersData {
  announcementTitle: string;
  readers: Array<ReaderInfo & { readAt: string }>;
  unread: ReaderInfo[];
  total: number;
  readCount: number;
  unreadCount: number;
}

// ─── 状态配置 ───
const STATUS_CONFIG: Record<AnnouncementStatus, { label: string; className: string }> = {
  DRAFT: { label: '草稿', className: 'border-gray-300 text-gray-600 bg-gray-50' },
  PUBLISHED: { label: '已发布', className: 'border-emerald-500 text-emerald-700 bg-emerald-50' },
  SCHEDULED: { label: '定时发送', className: 'border-amber-500 text-amber-700 bg-amber-50' },
};

const RECURRING_LABEL: Record<RecurringPattern, string> = {
  NONE: '不重复',
  DAILY: '每日',
  WEEKLY: '每周',
  MONTHLY: '每月',
};

// ─── 数据获取 ───
async function fetchAnnouncements(): Promise<AdminAnnouncement[]> {
  const res = await authFetch('/api/announcements');
  if (!res.ok) throw new Error('获取通告失败');
  const data = await res.json();
  return data.data ?? [];
}

async function fetchReaders(announcementId: string): Promise<ReadersData> {
  const res = await authFetch(`/api/announcements/${announcementId}/readers`);
  if (!res.ok) throw new Error('获取已读名单失败');
  const data = await res.json();
  return data.data;
}

// ─── 主页面 ───
export default function AdminAnnouncementsPage() {
  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ['admin-announcements'],
    queryFn: fetchAnnouncements,
  });

  const [showEditor, setShowEditor] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<AdminAnnouncement | null>(null);
  const [viewingReaders, setViewingReaders] = useState<AdminAnnouncement | null>(null);
  const [topTab, setTopTab] = useState<'announcements' | 'alerts'>('announcements');

  return (
    <div className="space-y-5">
      {/* 顶层 Tab */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        <button type="button" onClick={() => setTopTab('announcements')} className={cn('flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px', topTab === 'announcements' ? 'border-cyan-500 text-cyan-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300')}>
          <Megaphone className="size-4" /> 通告管理
        </button>
        <button type="button" onClick={() => setTopTab('alerts')} className={cn('flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px', topTab === 'alerts' ? 'border-amber-500 text-amber-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300')}>
          <ShieldAlert className="size-4" /> 安全预警
        </button>
      </div>

      {topTab === 'announcements' && (
      <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Megaphone className="size-4 text-cyan-500" />
          <span>共 {announcements.length} 条通告</span>
        </div>
        <Button onClick={() => { setEditingAnnouncement(null); setShowEditor(true); }}>
          <Plus className="size-4" /> 新建通告
        </Button>
      </div>

      {/* 通告列表 */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-8 animate-spin text-blue-500" />
        </div>
      ) : announcements.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex size-16 items-center justify-center rounded-full bg-gray-100">
              <Megaphone className="size-8 text-gray-400" />
            </div>
            <p className="mt-4 text-base font-medium text-gray-600">暂无通告</p>
            <p className="mt-1 text-sm text-gray-400">点击「新建通告」发布第一条实验室通告</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {announcements.map((ann) => (
            <AnnouncementCard
              key={ann.id}
              announcement={ann}
              onEdit={() => {
                setEditingAnnouncement(ann);
                setShowEditor(true);
              }}
              onViewReaders={() => setViewingReaders(ann)}
            />
          ))}
        </div>
      )}

      </div>
      )}

      {/* 安全预警 Tab */}
      {topTab === 'alerts' && <AlertsSection />}

      {/* 编辑/新建弹窗 */}
      {showEditor && (
        <AnnouncementEditor
          announcement={editingAnnouncement}
          onClose={() => {
            setShowEditor(false);
            setEditingAnnouncement(null);
          }}
        />
      )}

      {/* 已读人员弹窗 */}
      {viewingReaders && (
        <ReadersModal
          announcement={viewingReaders}
          onClose={() => setViewingReaders(null)}
        />
      )}
    </div>
  );
}

// ─── 通告卡片 ───
function AnnouncementCard({
  announcement,
  onEdit,
  onViewReaders,
}: {
  announcement: AdminAnnouncement;
  onEdit: () => void;
  onViewReaders: () => void;
}) {
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`/api/announcements/${announcement.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: '删除失败' }));
        throw new Error(data.error || '删除失败');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-announcements'] });
    },
  });

  const statusConfig = STATUS_CONFIG[announcement.status];
  const readCount = announcement._count?.reads ?? 0;

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-100 to-blue-100 text-cyan-600">
            <Megaphone className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-900">{announcement.title}</span>
              <Badge variant="outline" className={cn('text-[10px]', statusConfig.className)}>
                {statusConfig.label}
              </Badge>
              {announcement.llmOptimized && (
                <Badge variant="outline" className="text-[10px] border-violet-300 text-violet-600 bg-violet-50">
                  <Sparkles className="mr-0.5 size-2.5" />
                  AI 优化
                </Badge>
              )}
              {announcement.isRecurring && (
                <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-600 bg-blue-50">
                  <RefreshCw className="mr-0.5 size-2.5" />
                  {RECURRING_LABEL[announcement.recurringPattern]}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-gray-600 line-clamp-2 whitespace-pre-wrap">
              {announcement.content}
            </p>
            <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-400">
              <span>创建人：{announcement.createdBy.name}</span>
              <span>{format(new Date(announcement.createdAt), 'yyyy-MM-dd HH:mm')}</span>
              {announcement.scheduledAt && (
                <span className="flex items-center gap-0.5 text-amber-600">
                  <Clock className="size-3" />
                  定时：{format(new Date(announcement.scheduledAt), 'yyyy-MM-dd HH:mm')}
                </span>
              )}
              {announcement.status === 'PUBLISHED' && (
                <span className="flex items-center gap-0.5 text-emerald-600">
                  <Users className="size-3" />
                  已读 {readCount}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {announcement.status === 'PUBLISHED' && (
              <Button
                size="sm"
                variant="outline"
                onClick={onViewReaders}
                className="h-7 px-2 text-xs"
              >
                <Eye className="size-3" />
                已读情况
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={onEdit}
              className="h-7 px-2 text-xs"
            >
              <Edit3 className="size-3" />
              编辑
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (confirm(`确认删除通告「${announcement.title}」？此操作不可撤销。`)) {
                  deleteMutation.mutate();
                }
              }}
              disabled={deleteMutation.isPending}
              className="h-7 px-2 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── 通告编辑器 ───
function AnnouncementEditor({
  announcement,
  onClose,
}: {
  announcement: AdminAnnouncement | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isEditing = !!announcement;

  const [title, setTitle] = useState(announcement?.title ?? '');
  const [content, setContent] = useState(announcement?.content ?? '');
  const [status, setStatus] = useState<AnnouncementStatus>(announcement?.status ?? 'PUBLISHED');
  const [scheduledAt, setScheduledAt] = useState(
    announcement?.scheduledAt
      ? format(new Date(announcement.scheduledAt), "yyyy-MM-dd'T'HH:mm")
      : ''
  );
  const [isRecurring, setIsRecurring] = useState(announcement?.isRecurring ?? false);
  const [recurringPattern, setRecurringPattern] = useState<RecurringPattern>(
    announcement?.recurringPattern ?? 'NONE'
  );
  const [recurringTime, setRecurringTime] = useState(announcement?.recurringTime ?? '08:00');
  const [recurringDayOfWeek, setRecurringDayOfWeek] = useState<number>(announcement?.recurringDayOfWeek ?? 1);
  const [recurringDayOfMonth, setRecurringDayOfMonth] = useState<number>(announcement?.recurringDayOfMonth ?? 1);
  const [llmOptimized, setLlmOptimized] = useState(announcement?.llmOptimized ?? false);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState('');

  const saveMutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!title.trim() || !content.trim()) {
        throw new Error('标题和内容不能为空');
      }
      if (status === 'SCHEDULED' && !scheduledAt) {
        throw new Error('定时发送必须填写发布时间');
      }
      if (isRecurring && recurringPattern === 'NONE') {
        throw new Error('定期发送必须选择周期');
      }
      if (isRecurring && recurringPattern === 'WEEKLY' && !recurringDayOfWeek) {
        throw new Error('每周发送必须选择星期几');
      }
      if (isRecurring && recurringPattern === 'MONTHLY' && !recurringDayOfMonth) {
        throw new Error('每月发送必须选择几号');
      }

      const payload = {
        title: title.trim(),
        content: content.trim(),
        status,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        isRecurring: isRecurring && status === 'PUBLISHED',
        recurringPattern: isRecurring && status === 'PUBLISHED' ? recurringPattern : 'NONE',
        recurringTime: isRecurring && status === 'PUBLISHED' ? recurringTime : null,
        recurringDayOfWeek: isRecurring && status === 'PUBLISHED' && recurringPattern === 'WEEKLY' ? recurringDayOfWeek : null,
        recurringDayOfMonth: isRecurring && status === 'PUBLISHED' && recurringPattern === 'MONTHLY' ? recurringDayOfMonth : null,
        llmOptimized,
      };

      if (isEditing && announcement) {
        const res = await authFetch(`/api/announcements/${announcement.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: '保存失败' }));
          throw new Error(data.error || '保存失败');
        }
      } else {
        const res = await authFetch('/api/announcements', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: '创建失败' }));
          throw new Error(data.error || '创建失败');
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-announcements'] });
      onClose();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : '操作失败');
    },
  });

  const handleOptimize = async () => {
    setError('');
    if (!title.trim() || !content.trim()) {
      setError('请先填写标题和内容后再优化');
      return;
    }
    setOptimizing(true);
    try {
      const res = await authFetch('/api/announcements/optimize', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), content: content.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'LLM 优化失败');
      }
      setTitle(data.data.title);
      setContent(data.data.content);
      setLlmOptimized(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'LLM 优化失败');
    } finally {
      setOptimizing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Megaphone className="size-5 text-blue-500" />
            <h3 className="text-base font-semibold text-gray-900">
              {isEditing ? '编辑通告' : '新建通告'}
            </h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
            <X className="size-5" />
          </button>
        </div>

        {/* 表单内容 */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* 标题 */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">标题</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="请输入通告标题"
              maxLength={200}
            />
          </div>

          {/* 内容 */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-xs font-medium text-gray-700">正文</label>
              <button
                onClick={handleOptimize}
                disabled={optimizing}
                className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 disabled:opacity-50"
              >
                {optimizing ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Sparkles className="size-3" />
                )}
                {optimizing ? 'AI 优化中...' : 'AI 优化文案'}
              </button>
            </div>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="请输入通告正文（支持换行）"
              className="min-h-32"
              maxLength={5000}
            />
            <p className="mt-1 text-[11px] text-gray-400">{content.length}/5000 字</p>
          </div>

          {/* 发布方式 */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">发布方式</label>
            <div className="flex flex-wrap gap-2">
              {(['DRAFT', 'PUBLISHED', 'SCHEDULED'] as AnnouncementStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-xs transition-all',
                    status === s
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  )}
                >
                  {STATUS_CONFIG[s].label}
                </button>
              ))}
            </div>
          </div>

          {/* 定时发送时间 */}
          {status === 'SCHEDULED' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">发布时间</label>
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-gray-400">到达此时间后自动发布（实验员访问通告时触发）</p>
            </div>
          )}

          {/* 定期发送 */}
          {status === 'PUBLISHED' && (
            <div>
              <label className="mb-1 flex items-center gap-2 text-xs font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={isRecurring}
                  onChange={(e) => setIsRecurring(e.target.checked)}
                  className="size-3.5 rounded border-gray-300"
                />
                定期发送
              </label>
              {isRecurring && (
                <>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(['DAILY', 'WEEKLY', 'MONTHLY'] as RecurringPattern[]).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setRecurringPattern(p)}
                        className={cn(
                          'rounded-lg border px-3 py-1.5 text-xs transition-all',
                          recurringPattern === p
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                        )}
                      >
                        {RECURRING_LABEL[p]}
                      </button>
                    ))}
                  </div>

                  {/* 发布时间（每日/每周/每月通用）*/}
                  <div className="mt-3 flex items-center gap-2">
                    <label className="text-xs text-gray-600">发布时间</label>
                    <Input
                      type="time"
                      value={recurringTime}
                      onChange={(e) => setRecurringTime(e.target.value)}
                      className="h-8 w-28 text-xs"
                    />
                    <span className="text-[11px] text-gray-400">默认 08:00</span>
                  </div>

                  {/* 每周：选择星期几 */}
                  {recurringPattern === 'WEEKLY' && (
                    <div className="mt-3">
                      <label className="mb-1 block text-xs text-gray-600">每周几发布</label>
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          { v: 1, l: '周一' }, { v: 2, l: '周二' }, { v: 3, l: '周三' },
                          { v: 4, l: '周四' }, { v: 5, l: '周五' }, { v: 6, l: '周六' },
                          { v: 7, l: '周日' },
                        ].map((d) => (
                          <button
                            key={d.v}
                            type="button"
                            onClick={() => setRecurringDayOfWeek(d.v)}
                            className={cn(
                              'rounded-lg border px-2.5 py-1 text-xs transition-all',
                              recurringDayOfWeek === d.v
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                            )}
                          >
                            {d.l}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 每月：选择几号 */}
                  {recurringPattern === 'MONTHLY' && (
                    <div className="mt-3">
                      <label className="mb-1 block text-xs text-gray-600">
                        每月几号发布
                        <span className="ml-2 text-[10px] text-gray-400">
                          （若月份不足该日，自动取月底）
                        </span>
                      </label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          max={31}
                          value={recurringDayOfMonth}
                          onChange={(e) => setRecurringDayOfMonth(Math.max(1, Math.min(31, Number(e.target.value) || 1)))}
                          className="h-8 w-20 text-xs"
                        />
                        <span className="text-xs text-gray-500">号</span>
                      </div>
                    </div>
                  )}
                </>
              )}
              {isRecurring && (
                <p className="mt-2 text-[11px] text-gray-400">
                  开启后，将按所选周期自动派生新一期通告（实验员访问时触发派生）
                </p>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
            {isEditing ? '保存修改' : status === 'PUBLISHED' ? '立即发布' : status === 'SCHEDULED' ? '定时发送' : '存为草稿'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── 已读人员弹窗 ───
function ReadersModal({
  announcement,
  onClose,
}: {
  announcement: AdminAnnouncement;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['announcement-readers', announcement.id],
    queryFn: () => fetchReaders(announcement.id),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">已读情况</h3>
            <p className="mt-0.5 text-xs text-gray-500">{announcement.title}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
            <X className="size-5" />
          </button>
        </div>

        {/* 统计 */}
        {data && (
          <div className="grid grid-cols-3 gap-3 border-b border-gray-100 px-5 py-4">
            <div className="rounded-lg bg-gray-50 p-3 text-center">
              <p className="text-lg font-semibold text-gray-900">{data.total}</p>
              <p className="text-[11px] text-gray-500">总人数</p>
            </div>
            <div className="rounded-lg bg-emerald-50 p-3 text-center">
              <p className="text-lg font-semibold text-emerald-700">{data.readCount}</p>
              <p className="text-[11px] text-emerald-600">已读</p>
            </div>
            <div className="rounded-lg bg-amber-50 p-3 text-center">
              <p className="text-lg font-semibold text-amber-700">{data.unreadCount}</p>
              <p className="text-[11px] text-amber-600">未读</p>
            </div>
          </div>
        )}

        {/* 名单 */}
        <div className="flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-6 animate-spin text-blue-500" />
            </div>
          ) : data ? (
            <div className="space-y-4">
              {/* 已读 */}
              <div>
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 className="size-3.5" />
                  已读（{data.readers.length}）
                </h4>
                <div className="space-y-1.5">
                  {data.readers.length === 0 ? (
                    <p className="text-xs text-gray-400">暂无已读人员</p>
                  ) : (
                    data.readers.map((r) => (
                      <div key={r.userId} className="flex items-center justify-between rounded-lg bg-emerald-50/50 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex size-7 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-medium text-emerald-700">
                            {r.userName.charAt(0)}
                          </div>
                          <div>
                            <p className="text-xs font-medium text-gray-900">{r.userName}</p>
                            <p className="text-[10px] text-gray-400">{r.userEmail}</p>
                          </div>
                        </div>
                        <span className="text-[10px] text-gray-400">
                          {format(new Date(r.readAt), 'MM-dd HH:mm')}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* 未读 */}
              <div>
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                  <Clock className="size-3.5" />
                  未读（{data.unread.length}）
                </h4>
                <div className="space-y-1.5">
                  {data.unread.length === 0 ? (
                    <p className="text-xs text-gray-400">全部已读</p>
                  ) : (
                    data.unread.map((r) => (
                      <div key={r.userId} className="flex items-center justify-between rounded-lg bg-amber-50/50 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex size-7 items-center justify-center rounded-full bg-amber-100 text-[10px] font-medium text-amber-700">
                            {r.userName.charAt(0)}
                          </div>
                          <div>
                            <p className="text-xs font-medium text-gray-900">{r.userName}</p>
                            <p className="text-[10px] text-gray-400">{r.userEmail}</p>
                          </div>
                        </div>
                        {r.role === 'ADMIN' && (
                          <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-600 bg-blue-50">
                            管理员
                          </Badge>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-center text-sm text-gray-400">加载失败</p>
          )}
        </div>
      </div>
    </div>
  );
}
