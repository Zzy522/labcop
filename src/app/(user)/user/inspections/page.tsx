'use client';

import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, FileText, AlertCircle, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Dialog } from '@/arco-adapters/dialog';
import { Tabs } from '@/arco-adapters/tabs';
import { Label } from '@/components/ui/label';
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
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  assignee: { id: string; name: string };
  assigner: { id: string; name: string };
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

export default function UserInspectionsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('all');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<InspectionItem | null>(null);
  const [submitData, setSubmitData] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['user-inspections', activeTab],
    queryFn: () => fetchInspections(activeTab === 'all' ? undefined : activeTab),
  });

  const inspections: InspectionItem[] = data?.data ?? [];

  const openDetail = useCallback((item: InspectionItem) => {
    setDetailItem(item);
    setSubmitData(item.submittedData || '');
    setDetailOpen(true);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!detailItem) return;
    setSubmitting(true);
    try {
      const res = await authFetch(`/api/inspections/${detailItem.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'SUBMIT',
          submittedData: submitData || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || '提交失败');
      }
      setDetailOpen(false);
      setDetailItem(null);
      refetch();
      queryClient.invalidateQueries({ queryKey: ['user-inspections'] });
    } catch (err) {
      alert(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  }, [detailItem, submitData, refetch, queryClient]);

  const renderTable = (items: InspectionItem[]) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>任务标题</TableHead>
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
            <TableCell colSpan={6} className="py-8 text-center text-gray-500">暂无巡检任务</TableCell>
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
                <TableCell>{item.assigner?.name ?? '-'}</TableCell>
                <TableCell className="text-sm">{formatDateTime(item.dueDate)}</TableCell>
                <TableCell>
                  <Badge className={isOverdue && item.status === 'ASSIGNED' ? statusConfig.OVERDUE.className : status.className}>
                    {isOverdue && item.status === 'ASSIGNED' ? statusConfig.OVERDUE.label : status.label}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-gray-500">{formatDateTime(item.submittedAt)}</TableCell>
                <TableCell className="text-right">
                  {item.status === 'ASSIGNED' ? (
                    <span className="text-xs text-blue-600 font-medium">去执行</span>
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
    <div className="space-y-6">
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: 'all', label: '全部', content: <Card><CardContent className="p-0">{isLoading ? <LoadingState /> : renderTable(inspections)}</CardContent></Card> },
          { key: 'ASSIGNED', label: '待执行', content: <Card><CardContent className="p-0">{isLoading ? <LoadingState /> : renderTable(inspections)}</CardContent></Card> },
          { key: 'SUBMITTED', label: '待审核', content: <Card><CardContent className="p-0">{isLoading ? <LoadingState /> : renderTable(inspections)}</CardContent></Card> },
          { key: 'APPROVED', label: '已完成', content: <Card><CardContent className="p-0">{isLoading ? <LoadingState /> : renderTable(inspections)}</CardContent></Card> },
        ]}
      />

      {/* 详情/提交弹窗 */}
      <Dialog
        open={detailOpen}
        onOpenChange={(v) => { setDetailOpen(v); if (!v) setDetailItem(null); }}
        title="巡检任务详情"
        footer={
          <>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>关闭</Button>
            {detailItem?.status === 'ASSIGNED' && (
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? '提交中...' : '提交巡检结果'}
              </Button>
            )}
          </>
        }
      >
        {detailItem && (
          <div className="space-y-3 py-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">任务标题</span><span className="font-semibold">{detailItem.title}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">派发人</span><span>{detailItem.assigner?.name}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">状态</span><Badge className={statusConfig[detailItem.status]?.className}>{statusConfig[detailItem.status]?.label ?? detailItem.status}</Badge></div>
            <div className="flex justify-between"><span className="text-gray-500">截止时间</span><span>{formatDateTime(detailItem.dueDate)}</span></div>
            {detailItem.description && (
              <div className="rounded-md bg-gray-50 p-3">
                <div className="text-gray-500 mb-1">任务描述</div>
                <div className="whitespace-pre-wrap">{detailItem.description}</div>
              </div>
            )}
            {detailItem.status === 'ASSIGNED' ? (
              <div className="grid gap-2">
                <Label htmlFor="submit-data">巡检结果 *</Label>
                <Textarea
                  id="submit-data"
                  placeholder="请填写巡检结果，如：检查项清单、发现的问题、整改建议等"
                  value={submitData}
                  onChange={(e) => setSubmitData(e.target.value)}
                  rows={6}
                />
              </div>
            ) : (
              detailItem.submittedData && (
                <div className="rounded-md bg-blue-50 p-3">
                  <div className="text-blue-600 mb-1 flex items-center gap-1"><FileText className="size-3.5" />我的提交</div>
                  <div className="whitespace-pre-wrap">{detailItem.submittedData}</div>
                </div>
              )
            )}
            {detailItem.reviewNote && (
              <div className={`rounded-md p-3 ${detailItem.status === 'APPROVED' ? 'bg-green-50' : 'bg-red-50'}`}>
                <div className={`mb-1 flex items-center gap-1 ${detailItem.status === 'APPROVED' ? 'text-green-600' : 'text-red-600'}`}>
                  {detailItem.status === 'APPROVED' ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
                  审核意见
                </div>
                <div>{detailItem.reviewNote}</div>
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
