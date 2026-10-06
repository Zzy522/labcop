'use client';

import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Loader2, Check, X, AlertCircle, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Dialog } from '@/arco-adapters/dialog';
import { Tabs } from '@/arco-adapters/tabs';
import { Select } from '@/arco-adapters/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { authFetch } from '@/lib/auth-fetch';

interface InspectionItem {
  id: string;
  title: string;
  description: string | null;
  dueDate: string;
  status: string;
  submittedAt: string | null;
  submittedData: string | null;
  photoUrls: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  assignee: { id: string; name: string };
  assigner: { id: string; name: string };
}

interface LabMember {
  id: string;
  name: string;
  role: string;
  email: string;
}

const statusConfig: Record<string, { label: string; className: string }> = {
  ASSIGNED: { label: '待执行', className: 'bg-blue-100 text-blue-700' },
  SUBMITTED: { label: '待审核', className: 'bg-amber-100 text-amber-700' },
  APPROVED: { label: '已通过', className: 'bg-green-100 text-green-700' },
  REJECTED: { label: '已拒绝', className: 'bg-red-100 text-red-700' },
  OVERDUE: { label: '已逾期', className: 'bg-gray-200 text-gray-600' },
};

function formatDateTime(dateStr: string | null | undefined) {
  if (!dateStr) return '-';
  try { return format(new Date(dateStr), 'yyyy-MM-dd HH:mm'); } catch { return dateStr; }
}

async function fetchInspections(status?: string) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  const res = await authFetch(`/api/inspections?${params.toString()}`);
  if (!res.ok) throw new Error('获取巡检任务失败');
  return res.json();
}

async function fetchLabMembers() {
  const res = await authFetch('/api/labs/members');
  if (!res.ok) throw new Error('获取实验室成员失败');
  return res.json();
}

export default function AdminInspectionsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ assigneeId: '', title: '', description: '', dueDate: '' });
  const [creating, setCreating] = useState(false);

  // 详情/审核弹窗
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<InspectionItem | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [processing, setProcessing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['inspections', activeTab],
    queryFn: () => fetchInspections(activeTab === 'all' ? undefined : activeTab),
  });

  const { data: membersData } = useQuery({
    queryKey: ['lab-members'],
    queryFn: fetchLabMembers,
  });

  const inspections: InspectionItem[] = data?.data ?? [];
  const members: LabMember[] = (membersData?.data ?? []).filter((m: LabMember) => m.role === 'MEMBER');

  const handleCreate = useCallback(async () => {
    if (!createForm.assigneeId || !createForm.title || !createForm.dueDate) return;
    setCreating(true);
    try {
      const res = await authFetch('/api/inspections', {
        method: 'POST',
        body: JSON.stringify({
          assigneeId: createForm.assigneeId,
          title: createForm.title,
          description: createForm.description || undefined,
          dueDate: new Date(createForm.dueDate).toISOString(),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || '派发失败');
      }
      setCreateOpen(false);
      setCreateForm({ assigneeId: '', title: '', description: '', dueDate: '' });
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : '派发失败');
    } finally {
      setCreating(false);
    }
  }, [createForm, refetch]);

  const openDetail = useCallback((item: InspectionItem) => {
    setDetailItem(item);
    setReviewNote('');
    setDetailOpen(true);
  }, []);

  const handleReview = useCallback(async (action: 'APPROVE' | 'REJECT') => {
    if (!detailItem) return;
    setProcessing(true);
    try {
      const res = await authFetch(`/api/inspections/${detailItem.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action, reviewNote: reviewNote || undefined }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || '审核失败');
      }
      setDetailOpen(false);
      setDetailItem(null);
      refetch();
      queryClient.invalidateQueries({ queryKey: ['inspections'] });
    } catch (err) {
      alert(err instanceof Error ? err.message : '审核失败');
    } finally {
      setProcessing(false);
    }
  }, [detailItem, reviewNote, refetch, queryClient]);

  const renderTable = (items: InspectionItem[]) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>任务标题</TableHead>
          <TableHead>执行人</TableHead>
          <TableHead>派发人</TableHead>
          <TableHead>截止时间</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>提交时间</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.length === 0 ? (
          <TableRow>
            <TableCell colSpan={7} className="py-8 text-center text-gray-500">暂无巡检任务</TableCell>
          </TableRow>
        ) : (
          items.map((item) => {
            const status = statusConfig[item.status] ?? { label: item.status, className: '' };
            const isOverdue = item.status === 'ASSIGNED' && new Date(item.dueDate) < new Date();
            return (
              <TableRow key={item.id} className="cursor-pointer hover:bg-gray-50" onClick={() => openDetail(item)}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    {item.title}
                    {isOverdue && <AlertCircle className="size-3.5 text-red-500" />}
                  </div>
                </TableCell>
                <TableCell>{item.assignee?.name ?? '-'}</TableCell>
                <TableCell>{item.assigner?.name ?? '-'}</TableCell>
                <TableCell className="text-sm">{formatDateTime(item.dueDate)}</TableCell>
                <TableCell>
                  <Badge className={isOverdue && item.status === 'ASSIGNED' ? statusConfig.OVERDUE.className : status.className}>
                    {isOverdue && item.status === 'ASSIGNED' ? statusConfig.OVERDUE.label : status.label}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-gray-500">{formatDateTime(item.submittedAt)}</TableCell>
                <TableCell className="text-right">
                  {item.status === 'SUBMITTED' ? (
                    <span className="text-xs text-amber-600 font-medium">待审核</span>
                  ) : (
                    <span className="text-xs text-gray-400">查看</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );

  return (
    <div className="space-y-5">
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        tabBarExtra={
          <Button onClick={() => setCreateOpen(true)} className="h-9">
            <Plus className="size-4" />
            派发任务
          </Button>
        }
        items={[
          { key: 'all', label: '全部', content: <Card><CardContent className="p-0">{isLoading ? <LoadingState /> : renderTable(inspections)}</CardContent></Card> },
          { key: 'ASSIGNED', label: '待执行', content: <Card><CardContent className="p-0">{isLoading ? <LoadingState /> : renderTable(inspections)}</CardContent></Card> },
          { key: 'SUBMITTED', label: '待审核', content: <Card><CardContent className="p-0">{isLoading ? <LoadingState /> : renderTable(inspections)}</CardContent></Card> },
          { key: 'APPROVED', label: '已通过', content: <Card><CardContent className="p-0">{isLoading ? <LoadingState /> : renderTable(inspections)}</CardContent></Card> },
          { key: 'REJECTED', label: '已拒绝', content: <Card><CardContent className="p-0">{isLoading ? <LoadingState /> : renderTable(inspections)}</CardContent></Card> },
        ]}
      />

      {/* 派发任务弹窗 */}
      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="派发巡检任务"
        description="选择实验员并填写巡检任务信息"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>取消</Button>
            <Button onClick={handleCreate} disabled={creating || !createForm.assigneeId || !createForm.title || !createForm.dueDate}>
              {creating ? '派发中...' : '确认派发'}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>执行人 *</Label>
            <Select
              value={createForm.assigneeId || '__none__'}
              onChange={(v: string) => setCreateForm((f) => ({ ...f, assigneeId: v === '__none__' ? '' : v }))}
              placeholder="选择实验员"
              options={[
                { value: '__none__', label: '请选择执行人' },
                ...members.map((m) => ({ value: m.id, label: `${m.name}（${m.email || '无邮箱'}）` })),
              ]}
              style={{ width: '100%' }}
            />
            {members.length === 0 && (
              <p className="text-xs text-amber-600">本实验室暂无实验员，无法派发任务</p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="inspection-title">任务标题 *</Label>
            <Input id="inspection-title" placeholder="如：实验室周一安全巡查" value={createForm.title} onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="inspection-desc">任务描述</Label>
            <Textarea id="inspection-desc" placeholder="请描述巡检要点、检查项等" value={createForm.description} onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))} rows={3} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="inspection-due">截止时间 *</Label>
            <Input id="inspection-due" type="datetime-local" value={createForm.dueDate} onChange={(e) => setCreateForm((f) => ({ ...f, dueDate: e.target.value }))} />
          </div>
        </div>
      </Dialog>

      {/* 详情/审核弹窗 */}
      <Dialog
        open={detailOpen}
        onOpenChange={(v) => { setDetailOpen(v); if (!v) setDetailItem(null); }}
        title="巡检任务详情"
        footer={
          <>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>关闭</Button>
            {detailItem?.status === 'SUBMITTED' && (
              <>
                <Button
                  variant="outline"
                  className="border-red-200 text-red-700 hover:bg-red-50"
                  disabled={processing}
                  onClick={() => handleReview('REJECT')}
                >
                  <X className="size-4" />拒绝
                </Button>
                <Button
                  className="bg-green-600 hover:bg-green-700"
                  disabled={processing}
                  onClick={() => handleReview('APPROVE')}
                >
                  <Check className="size-4" />通过
                </Button>
              </>
            )}
          </>
        }
      >
        {detailItem && (
          <div className="space-y-3 py-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">任务标题</span><span className="font-semibold">{detailItem.title}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">执行人</span><span>{detailItem.assignee?.name}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">派发人</span><span>{detailItem.assigner?.name}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">状态</span><Badge className={statusConfig[detailItem.status]?.className}>{statusConfig[detailItem.status]?.label ?? detailItem.status}</Badge></div>
            <div className="flex justify-between"><span className="text-gray-500">截止时间</span><span>{formatDateTime(detailItem.dueDate)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">提交时间</span><span>{formatDateTime(detailItem.submittedAt)}</span></div>
            {detailItem.description && (
              <div className="rounded-md bg-gray-50 p-3">
                <div className="text-gray-500 mb-1">任务描述</div>
                <div>{detailItem.description}</div>
              </div>
            )}
            {detailItem.submittedData && (
              <div className="rounded-md bg-blue-50 p-3">
                <div className="text-blue-600 mb-1 flex items-center gap-1"><FileText className="size-3.5" />巡检结果</div>
                <div className="whitespace-pre-wrap">{detailItem.submittedData}</div>
              </div>
            )}
            {detailItem.reviewNote && (
              <div className="rounded-md bg-gray-50 p-3">
                <div className="text-gray-500 mb-1">审核意见</div>
                <div>{detailItem.reviewNote}</div>
              </div>
            )}
            {detailItem.status === 'SUBMITTED' && (
              <div className="grid gap-2">
                <Label htmlFor="review-note">审核意见</Label>
                <Textarea id="review-note" placeholder="可选：填写审核意见" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} rows={2} />
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="size-6 animate-spin text-gray-400" />
    </div>
  );
}
