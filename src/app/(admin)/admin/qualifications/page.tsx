'use client';

import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Loader2, Edit3, Trash2, UserPlus, ShieldCheck, X, Check, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Dialog } from '@/arco-adapters/dialog';
import { Select } from '@/arco-adapters/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { authFetch } from '@/lib/auth-fetch';

interface Qualification {
  id: string;
  name: string;
  description: string | null;
  validMonths: number;
  createdAt: string;
  _count?: {
    userQualifications: number;
    deviceRequirements: number;
    reagentRequirements: number;
  };
}

interface UserQualification {
  id: string;
  userId: string;
  qualificationId: string;
  grantedAt: string;
  expireAt: string;
  status: string;
  note: string | null;
  user: { id: string; name: string; role: string; email: string };
}

interface LabMember {
  id: string;
  name: string;
  role: string;
  email: string;
}

const statusConfig: Record<string, { label: string; className: string }> = {
  VALID: { label: '有效', className: 'bg-green-100 text-green-700' },
  EXPIRED: { label: '已过期', className: 'bg-gray-100 text-gray-600' },
  REVOKED: { label: '已撤销', className: 'bg-red-100 text-red-700' },
};

function formatDate(dateStr: string) {
  try { return format(new Date(dateStr), 'yyyy-MM-dd'); } catch { return dateStr; }
}

async function fetchQualifications() {
  const res = await authFetch('/api/qualifications');
  if (!res.ok) throw new Error('获取资质列表失败');
  return res.json();
}

async function fetchLabMembers() {
  const res = await authFetch('/api/labs/members');
  if (!res.ok) throw new Error('获取实验室成员失败');
  return res.json();
}

async function fetchQualificationDetail(id: string) {
  const res = await authFetch(`/api/qualifications/${id}`);
  if (!res.ok) throw new Error('获取资质详情失败');
  return res.json();
}

export default function QualificationsPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Qualification | null>(null);
  const [formData, setFormData] = useState({ name: '', description: '', validMonths: 36 });
  const [submitting, setSubmitting] = useState(false);

  // 详情弹窗
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<{
    id: string; name: string; description: string | null; validMonths: number;
    userQualifications: UserQualification[];
    deviceRequirements: Array<{ device: { id: string; name: string } }>;
    reagentRequirements: Array<{ reagent: { id: string; name: string } }>;
  } | null>(null);

  // 授权弹窗
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantQualificationId, setGrantQualificationId] = useState('');
  const [grantUserId, setGrantUserId] = useState('');
  const [grantNote, setGrantNote] = useState('');
  const [granting, setGranting] = useState(false);

  // 撤销处理中
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['qualifications'],
    queryFn: fetchQualifications,
  });

  const { data: membersData } = useQuery({
    queryKey: ['lab-members'],
    queryFn: fetchLabMembers,
  });

  const qualifications: Qualification[] = data?.data ?? [];
  const members: LabMember[] = (membersData?.data ?? []).filter((m: LabMember) => m.role === 'MEMBER');

  const openCreate = useCallback(() => {
    setEditTarget(null);
    setFormData({ name: '', description: '', validMonths: 36 });
    setCreateOpen(true);
  }, []);

  const openEdit = useCallback((q: Qualification) => {
    setEditTarget(q);
    setFormData({ name: q.name, description: q.description || '', validMonths: q.validMonths });
    setCreateOpen(true);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!formData.name.trim()) return;
    setSubmitting(true);
    try {
      const url = editTarget ? `/api/qualifications/${editTarget.id}` : '/api/qualifications';
      const method = editTarget ? 'PUT' : 'POST';
      const res = await authFetch(url, {
        method,
        body: JSON.stringify(formData),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '删除失败' }));
        throw new Error(err.error || '操作失败');
      }
      setCreateOpen(false);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : '操作失败');
    } finally {
      setSubmitting(false);
    }
  }, [editTarget, formData, refetch]);

  const handleDelete = useCallback(async (q: Qualification) => {
    if (!confirm(`确认删除资质模板「${q.name}」？`)) return;
    try {
      const res = await authFetch(`/api/qualifications/${q.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '删除失败' }));
        throw new Error(err.error || '删除失败');
      }
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : '删除失败');
    }
  }, [refetch]);

  const openDetail = useCallback(async (q: Qualification) => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const data = await fetchQualificationDetail(q.id);
      setDetailData(data.data);
    } catch (err) {
      alert(err instanceof Error ? err.message : '加载详情失败');
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const openGrant = useCallback((qualificationId: string) => {
    setGrantQualificationId(qualificationId);
    setGrantUserId('');
    setGrantNote('');
    setGrantOpen(true);
  }, []);

  const handleGrant = useCallback(async () => {
    if (!grantQualificationId || !grantUserId) return;
    setGranting(true);
    try {
      const res = await authFetch(`/api/qualifications/${grantQualificationId}/grant`, {
        method: 'POST',
        body: JSON.stringify({ userId: grantUserId, note: grantNote || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '删除失败' }));
        throw new Error(err.error || '授权失败');
      }
      setGrantOpen(false);
      // 刷新详情
      if (detailData?.id === grantQualificationId) {
        const data = await fetchQualificationDetail(grantQualificationId);
        setDetailData(data.data);
      }
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : '授权失败');
    } finally {
      setGranting(false);
    }
  }, [grantQualificationId, grantUserId, grantNote, detailData, refetch]);

  const handleRevoke = useCallback(async (userQualId: string) => {
    setRevokingId(userQualId);
    try {
      const res = await authFetch(`/api/user-qualifications/${userQualId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'REVOKE' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '删除失败' }));
        throw new Error(err.error || '撤销失败');
      }
      // 刷新详情
      if (detailData) {
        const data = await fetchQualificationDetail(detailData.id);
        setDetailData(data.data);
      }
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : '撤销失败');
    } finally {
      setRevokingId(null);
    }
  }, [detailData, refetch]);

  const now = new Date();

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button onClick={openCreate}>
          <Plus className="size-4" />
          新增资质
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-gray-400" />
        </div>
      ) : qualifications.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ShieldCheck className="size-12 mx-auto mb-3 text-gray-300" />
            <p className="text-sm text-gray-500">暂无资质模板，点击“新增资质”创建</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {qualifications.map((q) => (
            <Card key={q.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => openDetail(q)}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{q.name}</CardTitle>
                  <Badge variant="outline">{q.validMonths}个月</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-500 line-clamp-2 min-h-[40px]">{q.description || '无描述'}</p>
                <div className="mt-3 flex items-center gap-3 text-xs text-gray-400">
                  <span>{q._count?.userQualifications ?? 0} 人持有</span>
                  <span>{q._count?.deviceRequirements ?? 0} 设备要求</span>
                  <span>{q._count?.reagentRequirements ?? 0} 试剂要求</span>
                </div>
                <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => openEdit(q)}>
                    <Edit3 className="size-3.5" />编辑
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-600" onClick={() => handleDelete(q)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 创建/编辑弹窗 */}
      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={editTarget ? '编辑资质' : '新增资质'}
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={submitting}>取消</Button>
            <Button onClick={handleSubmit} disabled={submitting || !formData.name.trim()}>
              {submitting ? '保存中...' : '保存'}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="qual-name">资质名称 *</Label>
            <Input id="qual-name" placeholder="如：HPLC操作资质" value={formData.name} onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="qual-desc">描述</Label>
            <Textarea id="qual-desc" placeholder="资质的描述、培训要求等" value={formData.description} onChange={(e) => setFormData((f) => ({ ...f, description: e.target.value }))} rows={3} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="qual-months">有效期（月）</Label>
            <Input id="qual-months" type="number" min={1} max={120} value={formData.validMonths} onChange={(e) => setFormData((f) => ({ ...f, validMonths: parseInt(e.target.value) || 36 }))} />
          </div>
        </div>
      </Dialog>

      {/* 详情弹窗 */}
      <Dialog
        open={detailOpen}
        onOpenChange={(v) => { setDetailOpen(v); if (!v) setDetailData(null); }}
        title={detailData?.name || '资质详情'}
        footer={
          <>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>关闭</Button>
            {detailData && (
              <Button onClick={() => openGrant(detailData.id)} disabled={members.length === 0}>
                <UserPlus className="size-4" />授权用户
              </Button>
            )}
          </>
        }
      >
        {detailLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="size-6 animate-spin text-gray-400" /></div>
        ) : detailData ? (
          <div className="space-y-4 py-2 text-sm">
            {detailData.description && (
              <div className="rounded-md bg-gray-50 p-3">
                <div className="text-gray-500 mb-1">描述</div>
                <div>{detailData.description}</div>
              </div>
            )}
            <div className="flex gap-4">
              <div><span className="text-gray-500">有效期：</span><span className="font-medium">{detailData.validMonths} 个月</span></div>
              <div><span className="text-gray-500">已授权：</span><span className="font-medium">{detailData.userQualifications.length} 人</span></div>
            </div>

            {/* 关联设备 */}
            {detailData.deviceRequirements.length > 0 && (
              <div>
                <div className="text-gray-500 mb-2">要求此资质的设备</div>
                <div className="flex flex-wrap gap-2">
                  {detailData.deviceRequirements.map((d) => (
                    <Badge key={d.device.id} variant="outline">{d.device.name}</Badge>
                  ))}
                </div>
              </div>
            )}

            {/* 关联试剂 */}
            {detailData.reagentRequirements.length > 0 && (
              <div>
                <div className="text-gray-500 mb-2">要求此资质的试剂</div>
                <div className="flex flex-wrap gap-2">
                  {detailData.reagentRequirements.map((r) => (
                    <Badge key={r.reagent.id} variant="outline">{r.reagent.name}</Badge>
                  ))}
                </div>
              </div>
            )}

            {/* 已授权用户列表 */}
            <div>
              <div className="text-gray-500 mb-2">已授权用户</div>
              {detailData.userQualifications.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">暂无授权用户</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>用户</TableHead>
                      <TableHead>授权日期</TableHead>
                      <TableHead>到期日期</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detailData.userQualifications.map((uq) => {
                      const isExpired = uq.status === 'VALID' && new Date(uq.expireAt) < now;
                      const status = isExpired ? 'EXPIRED' : uq.status;
                      const statusInfo = statusConfig[status] ?? { label: status, className: '' };
                      return (
                        <TableRow key={uq.id}>
                          <TableCell className="font-medium">{uq.user.name}</TableCell>
                          <TableCell className="text-sm">{formatDate(uq.grantedAt)}</TableCell>
                          <TableCell className="text-sm">{formatDate(uq.expireAt)}</TableCell>
                          <TableCell><Badge className={statusInfo.className}>{statusInfo.label}</Badge></TableCell>
                          <TableCell className="text-right">
                            {uq.status !== 'REVOKED' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-red-600"
                                disabled={revokingId === uq.id}
                                onClick={() => handleRevoke(uq.id)}
                              >
                                {revokingId === uq.id ? '撤销中...' : '撤销'}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        ) : null}
      </Dialog>

      {/* 授权弹窗 */}
      <Dialog
        open={grantOpen}
        onOpenChange={setGrantOpen}
        title="授权用户"
        footer={
          <>
            <Button variant="outline" onClick={() => setGrantOpen(false)} disabled={granting}>取消</Button>
            <Button onClick={handleGrant} disabled={granting || !grantUserId}>
              {granting ? '授权中...' : '确认授权'}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>选择用户 *</Label>
            <Select
              value={grantUserId || '__none__'}
              onChange={(v: string) => setGrantUserId(v === '__none__' ? '' : v)}
              placeholder="选择实验员"
              options={[
                { value: '__none__', label: '请选择用户' },
                ...members.map((m) => ({ value: m.id, label: `${m.name}（${m.email || '无邮箱'}）` })),
              ]}
              style={{ width: '100%' }}
            />
            {members.length === 0 && (
              <p className="text-xs text-amber-600">本实验室暂无实验员</p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="grant-note">备注</Label>
            <Textarea id="grant-note" placeholder="可选：培训情况、考核结果等" value={grantNote} onChange={(e) => setGrantNote(e.target.value)} rows={2} />
          </div>
        </div>
      </Dialog>
    </div>
  );
}
