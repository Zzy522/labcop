'use client';

import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Wrench, Clock, Edit3, Trash2, History, Loader2, AlertTriangle, Calendar, CalendarRange, Check, X, Settings, User } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Dialog } from '@/arco-adapters/dialog';
import { Tabs } from '@/arco-adapters/tabs';
import { Select } from '@/arco-adapters/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import WeekScheduler from '@/components/booking/week-scheduler';
import DeviceGantt from '@/components/booking/device-gantt';
import type { Device, DeviceUsage, CreateDeviceUsageRequest } from '../types';
import { authFetch } from '@/lib/auth-fetch';
import { useAuthStore } from '@/store/auth-store';

const statusConfig: Record<Device['status'], { label: string; className: string }> = {
  IDLE: { label: '空闲', className: 'bg-gray-100 text-gray-700' },
  IN_USE: { label: '使用中', className: 'bg-green-100 text-green-700' },
  MAINTENANCE: { label: '维护中', className: 'bg-orange-100 text-orange-700' },
  DISABLED: { label: '已停用', className: 'bg-red-100 text-red-700' },
  SCRAPPED: { label: '已报废', className: 'bg-gray-200 text-gray-500' },
};

const riskLevelConfig: Record<Device['riskLevel'], { label: string; className: string }> = {
  LOW: { label: '低风险', className: 'bg-blue-100 text-blue-700' },
  MEDIUM: { label: '中风险', className: 'bg-yellow-100 text-yellow-700' },
  HIGH: { label: '高风险', className: 'bg-orange-100 text-orange-700' },
  CRITICAL: { label: '极高风险', className: 'bg-red-100 text-red-700' },
};

const usageStatusConfig: Record<string, { label: string; className: string }> = {
  NORMAL: { label: '正常', className: 'bg-green-100 text-green-700' },
  ABNORMAL: { label: '异常', className: 'bg-red-100 text-red-700' },
  COMPLETED: { label: '已完成', className: 'bg-gray-100 text-gray-700' },
};

// 状态流转配置：定义每种状态下可执行的状态变更（IN_USE 不可直接设置，需走申请使用流程）
const statusTransitions: Record<string, Array<{ value: string; label: string }>> = {
  IDLE: [{ value: 'MAINTENANCE', label: '转为维护中' }, { value: 'DISABLED', label: '停用设备' }],
  IN_USE: [{ value: 'IDLE', label: '结束使用并设为空闲' }, { value: 'MAINTENANCE', label: '终止使用并维护' }, { value: 'DISABLED', label: '终止使用并停用' }],
  MAINTENANCE: [{ value: 'IDLE', label: '维护完成，恢复空闲' }, { value: 'DISABLED', label: '停用设备' }],
  DISABLED: [{ value: 'IDLE', label: '恢复为空闲' }, { value: 'MAINTENANCE', label: '转为维护中' }],
  SCRAPPED: [],
};

async function fetchDevice(id: string) {
  const res = await authFetch(`/api/devices/${id}`);
  if (!res.ok) {
    let msg = '获取设备详情失败';
    try { const err = await res.json(); msg = err.error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

async function fetchDeviceUsages(id: string) {
  const res = await authFetch(`/api/devices/${id}/usage`);
  if (!res.ok) throw new Error('获取使用记录失败');
  return res.json();
}

async function releaseDeviceApi(deviceId: string) {
  const res = await authFetch(`/api/devices/${deviceId}/release`, { method: 'POST' });
  if (!res.ok) { const err = await res.json(); throw new Error(err.error || '释放设备失败'); }
  return res.json();
}

async function changeDeviceStatusApi(deviceId: string, status: string, reason?: string) {
  const res = await authFetch(`/api/devices/${deviceId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, reason: reason || undefined }),
  });
  if (!res.ok) { const err = await res.json(); throw new Error(err.error || '状态变更失败'); }
  return res.json();
}

async function fetchAuditLogs(id: string) {
  const res = await authFetch(`/api/audit-logs?targetType=DEVICE&targetId=${id}&pageSize=50`);
  if (!res.ok) throw new Error('获取变更记录失败');
  return res.json();
}

async function applyDeviceUsage(deviceId: string, data: CreateDeviceUsageRequest) {
  const res = await authFetch(`/api/devices/${deviceId}/usage`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!res.ok) { const err = await res.json(); throw new Error(err.error || '申请使用失败'); }
  return res.json();
}

async function updateDeviceApi(deviceId: string, data: Record<string, unknown>) {
  const res = await authFetch(`/api/devices/${deviceId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  if (!res.ok) { const err = await res.json(); throw new Error(err.error || '更新设备失败'); }
  return res.json();
}

async function scrapDeviceApi(deviceId: string, reason: string) {
  const res = await authFetch(`/api/devices/${deviceId}/scrap`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) { const err = await res.json(); throw new Error(err.error || '报废失败'); }
  return res.json();
}

function formatDateTime(dateStr: string | null | undefined) {
  if (!dateStr) return '-';
  try { return format(new Date(dateStr), 'yyyy-MM-dd HH:mm'); } catch { return dateStr; }
}

export default function AdminDeviceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const deviceId = params.id as string;
  const userId = useAuthStore((s) => s.user?.id ?? '');
  const userName = useAuthStore((s) => s.user?.name ?? '当前用户');

  const [usageDialogOpen, setUsageDialogOpen] = useState(false);
  const [usageForm, setUsageForm] = useState<CreateDeviceUsageRequest>({ userId: userId, purpose: '', startTime: '', endTime: '' });
  const [applying, setApplying] = useState(false);

  // 编辑弹窗
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState<{ name: string; model: string; serialNumber: string; location: string; riskLevel: string }>({ name: '', model: '', serialNumber: '', location: '', riskLevel: 'LOW' });
  const [editing, setEditing] = useState(false);

  // 报废弹窗
  const [scrapDialogOpen, setScrapDialogOpen] = useState(false);
  const [scrapReason, setScrapReason] = useState('');
  const [scrapping, setScrapping] = useState(false);

  // 预约刷新信号（用于触发 WeekScheduler 重新加载）
  const [reservationRefreshSignal, setReservationRefreshSignal] = useState(0);
  // 审批处理中
  const [processingId, setProcessingId] = useState<string | null>(null);

  // 状态变更弹窗
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [statusTargetNew, setStatusTargetNew] = useState('');
  const [statusReason, setStatusReason] = useState('');
  const [statusChanging, setStatusChanging] = useState(false);

  // 释放设备
  const [releasing, setReleasing] = useState(false);

  const { data: device, isLoading: deviceLoading, isError: deviceError, error: deviceErrorObj, refetch: refetchDevice } = useQuery({
    queryKey: ['device', deviceId],
    queryFn: () => fetchDevice(deviceId),
    enabled: !!deviceId,
  });

  const { data: usages = [], isLoading: usagesLoading, refetch: refetchUsages } = useQuery<DeviceUsage[]>({
    queryKey: ['device-usages', deviceId],
    queryFn: () => fetchDeviceUsages(deviceId),
    enabled: !!deviceId,
  });

  const { data: auditLogsData, isLoading: auditLoading, refetch: refetchAudit } = useQuery({
    queryKey: ['device-audit-logs', deviceId],
    queryFn: () => fetchAuditLogs(deviceId),
    enabled: !!deviceId,
  });

  // 待审批预约列表（仅管理员）
  const { data: pendingReservationsData, isLoading: pendingLoading, refetch: refetchPending } = useQuery({
    queryKey: ['device-pending-reservations', deviceId],
    queryFn: async () => {
      const res = await authFetch(`/api/reservations?deviceId=${deviceId}&status=PENDING`);
      if (!res.ok) throw new Error('获取待审批预约失败');
      return res.json();
    },
    enabled: !!deviceId,
  });

  const isScrapped = device?.status === 'SCRAPPED';

  const handleApplyUsage = useCallback(async () => {
    if (!usageForm.purpose || !usageForm.startTime || !usageForm.endTime) return;
    setApplying(true);
    try {
      const payload = {
        ...usageForm,
        userId: userId,
        startTime: new Date(usageForm.startTime).toISOString(),
        endTime: new Date(usageForm.endTime).toISOString(),
      };
      await applyDeviceUsage(deviceId, payload);
      setUsageDialogOpen(false);
      setUsageForm({ userId: userId, purpose: '', startTime: '', endTime: '' });
      refetchDevice();
      refetchUsages();
    } catch (err) {
      alert(err instanceof Error ? err.message : '申请使用失败');
    } finally {
      setApplying(false);
    }
  }, [deviceId, usageForm, userId, refetchDevice, refetchUsages]);

  const openEditDialog = useCallback(() => {
    if (!device) return;
    setEditForm({
      name: device.name ?? '',
      model: device.model ?? '',
      serialNumber: device.serialNumber ?? '',
      location: device.location ?? '',
      riskLevel: device.riskLevel ?? 'LOW',
    });
    setEditDialogOpen(true);
  }, [device]);

  const handleEditSave = useCallback(async () => {
    if (!editForm.name.trim()) return;
    setEditing(true);
    try {
      await updateDeviceApi(deviceId, editForm);
      setEditDialogOpen(false);
      refetchDevice();
      queryClient.invalidateQueries({ queryKey: ['device-audit-logs', deviceId] });
    } catch (err) {
      alert(err instanceof Error ? err.message : '更新设备失败');
    } finally {
      setEditing(false);
    }
  }, [deviceId, editForm, refetchDevice, queryClient]);

  const handleScrap = useCallback(async () => {
    if (!scrapReason.trim()) return;
    setScrapping(true);
    try {
      await scrapDeviceApi(deviceId, scrapReason);
      setScrapDialogOpen(false);
      setScrapReason('');
      refetchDevice();
      queryClient.invalidateQueries({ queryKey: ['device-audit-logs', deviceId] });
    } catch (err) {
      alert(err instanceof Error ? err.message : '报废失败');
    } finally {
      setScrapping(false);
    }
  }, [deviceId, scrapReason, refetchDevice, queryClient]);

  // 预约审批：通过/拒绝
  const handleReviewReservation = useCallback(async (reservationId: string, action: 'APPROVE' | 'REJECT') => {
    setProcessingId(reservationId);
    try {
      const res = await authFetch(`/api/reservations/${reservationId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || '审批失败');
      }
      // 刷新待审批列表和周视图
      refetchPending();
      setReservationRefreshSignal((s) => s + 1);
    } catch (err) {
      alert(err instanceof Error ? err.message : '审批失败');
    } finally {
      setProcessingId(null);
    }
  }, [refetchPending]);

  // 状态变更
  const openStatusDialog = useCallback((newStatus: string) => {
    setStatusTargetNew(newStatus);
    setStatusReason('');
    setStatusDialogOpen(true);
  }, []);

  const handleStatusChange = useCallback(async () => {
    if (!statusTargetNew) return;
    setStatusChanging(true);
    try {
      await changeDeviceStatusApi(deviceId, statusTargetNew, statusReason || undefined);
      setStatusDialogOpen(false);
      refetchDevice();
      refetchUsages();
      queryClient.invalidateQueries({ queryKey: ['device-audit-logs', deviceId] });
    } catch (err) {
      alert(err instanceof Error ? err.message : '状态变更失败');
    } finally {
      setStatusChanging(false);
    }
  }, [deviceId, statusTargetNew, statusReason, refetchDevice, refetchUsages, queryClient]);

  // 释放设备（结束当前使用）
  const handleRelease = useCallback(async () => {
    setReleasing(true);
    try {
      await releaseDeviceApi(deviceId);
      refetchDevice();
      refetchUsages();
      queryClient.invalidateQueries({ queryKey: ['device-audit-logs', deviceId] });
    } catch (err) {
      alert(err instanceof Error ? err.message : '释放设备失败');
    } finally {
      setReleasing(false);
    }
  }, [deviceId, refetchDevice, refetchUsages, queryClient]);

  if (deviceLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-muted rounded w-48 animate-pulse" />
        <Card className="animate-pulse"><CardHeader><div className="h-6 bg-muted rounded w-1/3" /></CardHeader><CardContent><div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-4 bg-muted rounded w-full" />)}</div></CardContent></Card>
      </div>
    );
  }

  if (deviceError || !device) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Wrench className="size-12 text-muted-foreground mb-4" />
        <p className="text-lg font-medium">加载失败</p>
        <p className="text-sm text-muted-foreground mt-1">{deviceErrorObj?.message || '设备不存在或已被删除'}</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push('/admin/equipment')}>返回设备列表</Button>
      </div>
    );
  }

  const statusInfo = statusConfig[device.status as Device['status']] ?? statusConfig.IDLE;
  const riskInfo = riskLevelConfig[device.riskLevel as Device['riskLevel']] ?? riskLevelConfig.LOW;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => router.push('/admin/equipment')}><ArrowLeft className="size-4" /></Button>
          <div>
            <h1 className="text-2xl font-bold">{device.name}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">设备详情与使用记录</p>
          </div>
        </div>
        {!isScrapped && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={openEditDialog}><Edit3 className="size-4" />编辑</Button>
            <Button variant="destructive" size="sm" onClick={() => setScrapDialogOpen(true)}><Trash2 className="size-4" />报废</Button>
          </div>
        )}
      </div>

      {isScrapped && (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
          <AlertTriangle className="size-4 text-gray-400" />
          <span>该设备已于 {formatDateTime(device.scrappedAt)} 报废{device.scrappedReason ? `，原因：${device.scrappedReason}` : ''}。报废设备不可编辑、不可预约。</span>
        </div>
      )}

      <Tabs
        defaultActiveKey="info"
        items={[
          {
            key: 'info',
            label: '设备信息',
            content: (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>设备信息</CardTitle>
                      <div className="flex items-center gap-2">
                        <Badge className={statusInfo.className}>{statusInfo.label}</Badge>
                        <Badge className={riskInfo.className} variant="outline">{riskInfo.label}</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4 text-sm">
                      <div><span className="text-muted-foreground">设备型号</span><p className="font-medium mt-0.5">{device.model || '未填写'}</p></div>
                      <div><span className="text-muted-foreground">序列号</span><p className="font-medium mt-0.5">{device.serialNumber || '未填写'}</p></div>
                      <div><span className="text-muted-foreground">存放位置</span><p className="font-medium mt-0.5">{device.location || '未指定'}</p></div>
                      {device.lab && <div><span className="text-muted-foreground">所属实验室</span><p className="font-medium mt-0.5">{device.lab.name}</p></div>}
                      <div><span className="text-muted-foreground">创建时间</span><p className="font-medium mt-0.5">{formatDateTime(device.createdAt)}</p></div>
                      <div><span className="text-muted-foreground">更新时间</span><p className="font-medium mt-0.5">{formatDateTime(device.updatedAt)}</p></div>
                    </div>
                  </CardContent>
                </Card>

                {/* 状态管理与流转 */}
                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Settings className="size-4 text-muted-foreground" />
                      <CardTitle>状态管理</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* 当前状态 */}
                    <div className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50/50 p-3">
                      <span className="text-sm text-muted-foreground">当前状态：</span>
                      <Badge className={statusInfo.className}>{statusInfo.label}</Badge>
                      {device.status === 'IN_USE' && (
                        <span className="text-xs text-gray-400">（设备正在被使用，不可直接预约）</span>
                      )}
                    </div>

                    {/* 当前使用人信息（IN_USE 时显示） */}
                    {device.status === 'IN_USE' && device.deviceUsages && device.deviceUsages.length > 0 && (
                      <div className="rounded-lg border border-green-200 bg-green-50/50 p-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-green-800 mb-2">
                          <User className="size-4" />
                          当前使用人信息
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                          <div><span className="text-gray-500">使用人</span><p className="font-medium mt-0.5">{device.deviceUsages[0]?.user?.name ?? '未知'}</p></div>
                          <div><span className="text-gray-500">开始时间</span><p className="font-medium mt-0.5">{formatDateTime(device.deviceUsages[0]?.startTime)}</p></div>
                          <div><span className="text-gray-500">预计结束</span><p className="font-medium mt-0.5">{device.deviceUsages[0]?.endTime ? formatDateTime(device.deviceUsages[0].endTime) : '进行中'}</p></div>
                          <div><span className="text-gray-500">用途</span><p className="font-medium mt-0.5">{device.deviceUsages[0]?.purpose || '未填写'}</p></div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3 border-green-300 text-green-700 hover:bg-green-50"
                          disabled={releasing}
                          onClick={handleRelease}
                        >
                          {releasing ? <><Loader2 className="size-4 animate-spin" />释放中...</> : <>释放设备</>}
                        </Button>
                      </div>
                    )}

                    {/* 状态流转操作 */}
                    {!isScrapped && statusTransitions[device.status]?.length > 0 && (
                      <div>
                        <p className="text-sm text-muted-foreground mb-2">可执行的状态变更：</p>
                        <div className="flex flex-wrap gap-2">
                          {statusTransitions[device.status].map((transition) => (
                            <Button
                              key={transition.value}
                              variant="outline"
                              size="sm"
                              onClick={() => openStatusDialog(transition.value)}
                            >
                              {transition.label}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 状态流转图示 */}
                    <div className="rounded-lg border border-gray-100 bg-gray-50/30 p-3">
                      <p className="text-xs font-medium text-gray-500 mb-2">状态流转规则</p>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
                        <Badge variant="outline" className="text-[10px]">空闲</Badge>
                        <span>→</span>
                        <Badge variant="outline" className="text-[10px]">使用中</Badge>
                        <span className="text-gray-400">（申请使用）</span>
                        <span className="mx-1">|</span>
                        <Badge variant="outline" className="text-[10px]">空闲</Badge>
                        <span>→</span>
                        <Badge variant="outline" className="text-[10px]">维护中</Badge>
                        <span>→</span>
                        <Badge variant="outline" className="text-[10px]">空闲</Badge>
                        <span className="mx-1">|</span>
                        <Badge variant="outline" className="text-[10px]">停用</Badge>
                        <span>→</span>
                        <Badge variant="outline" className="text-[10px]">空闲</Badge>
                        <span className="mx-1">|</span>
                        <Badge variant="outline" className="text-[10px] text-gray-400">报废（不可逆）</Badge>
                      </div>
                      <p className="mt-2 text-[11px] text-gray-400">注：“使用中”状态需通过申请使用流程进入，不可直接设置；管理员可终止使用并流转到其他状态。</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ),
          },
          {
            key: 'usages',
            label: '使用记录',
            content: (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2"><Clock className="size-4 text-muted-foreground" /><CardTitle>使用记录</CardTitle></div>
                    {!isScrapped && <Button onClick={() => setUsageDialogOpen(true)}>申请使用</Button>}
                  </div>
                </CardHeader>
                <CardContent>
                  {usagesLoading ? (
                    <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-10 bg-muted rounded animate-pulse" />)}</div>
                  ) : usages.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground"><Clock className="size-8 mx-auto mb-2 opacity-50" /><p className="text-sm">暂无使用记录</p></div>
                  ) : (
                    <Table>
                      <TableHeader><TableRow><TableHead>使用人</TableHead><TableHead>开始时间</TableHead><TableHead>结束时间</TableHead><TableHead>用途</TableHead><TableHead>状态</TableHead><TableHead>备注</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {usages.map((usage: DeviceUsage) => {
                          const usageStatus = usageStatusConfig[usage.status] ?? usageStatusConfig.NORMAL;
                          return (
                            <TableRow key={usage.id}>
                              <TableCell>{usage.user?.name ?? usage.userId}</TableCell>
                              <TableCell>{formatDateTime(usage.startTime)}</TableCell>
                              <TableCell>{formatDateTime(usage.endTime)}</TableCell>
                              <TableCell className="max-w-[200px] truncate">{usage.purpose || '-'}</TableCell>
                              <TableCell><Badge className={usageStatus.className}>{usageStatus.label}</Badge></TableCell>
                              <TableCell className="max-w-[150px] truncate">{usage.note || '-'}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            ),
          },
          {
            key: 'reservations',
            label: (
              <span className="flex items-center gap-1.5">
                <Calendar className="size-3.5" />
                预约排期
                {pendingReservationsData?.data?.length > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-amber-500 rounded-full">
                    {pendingReservationsData.data.length}
                  </span>
                )}
              </span>
            ),
            content: (
              <div className="space-y-4">
                {/* 甘特总览：使用记录 + 预约 时间线可视化（只读） */}
                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <CalendarRange className="size-4 text-muted-foreground" />
                      <CardTitle>使用与预约甘特总览</CardTitle>
                      <span className="text-xs text-muted-foreground">（只读，近 7 天历史 + 未来 7 天排期）</span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <DeviceGantt deviceId={deviceId} refreshSignal={reservationRefreshSignal} />
                  </CardContent>
                </Card>

                {/* 待审批预约 */}
                {!isScrapped && pendingReservationsData?.data?.length > 0 && (
                  <Card className="border-amber-200">
                    <CardHeader>
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="size-4 text-amber-500" />
                        <CardTitle className="text-base">待审批预约（{pendingReservationsData.data.length}）</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {pendingLoading ? (
                        <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-10 bg-muted rounded animate-pulse" />)}</div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>申请人</TableHead>
                              <TableHead>开始时间</TableHead>
                              <TableHead>结束时间</TableHead>
                              <TableHead>用途</TableHead>
                              <TableHead>基金/课题</TableHead>
                              <TableHead className="text-right">操作</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {pendingReservationsData.data.map((r: {
                              id: string; user: { name: string };
                              startTime: string; endTime: string; purpose?: string | null; fundInfo?: string | null;
                            }) => (
                              <TableRow key={r.id}>
                                <TableCell className="font-medium">{r.user?.name ?? '-'}</TableCell>
                                <TableCell>{formatDateTime(r.startTime)}</TableCell>
                                <TableCell>{formatDateTime(r.endTime)}</TableCell>
                                <TableCell className="max-w-[200px] truncate">{r.purpose || '-'}</TableCell>
                                <TableCell className="max-w-[120px] truncate">{r.fundInfo || '-'}</TableCell>
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="border-green-200 text-green-700 hover:bg-green-50"
                                      disabled={processingId === r.id}
                                      onClick={() => handleReviewReservation(r.id, 'APPROVE')}
                                    >
                                      <Check className="size-3.5" />通过
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="border-red-200 text-red-700 hover:bg-red-50"
                                      disabled={processingId === r.id}
                                      onClick={() => handleReviewReservation(r.id, 'REJECT')}
                                    >
                                      <X className="size-3.5" />拒绝
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* 周视图滑动框选 */}
                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Calendar className="size-4 text-muted-foreground" />
                      <CardTitle>预约排期（滑动框选即可预约）</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {!isScrapped ? (
                      <WeekScheduler
                        deviceId={deviceId}
                        deviceName={device.name}
                        deviceRiskLevel={device.riskLevel}
                        refreshSignal={reservationRefreshSignal}
                      />
                    ) : (
                      <div className="text-center py-12 text-muted-foreground">
                        <Calendar className="size-10 mx-auto mb-3 opacity-40" />
                        <p className="text-sm">设备已报废，无法预约</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            ),
          },
          {
            key: 'audit',
            label: '变更记录',
            content: (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2"><History className="size-4 text-muted-foreground" /><CardTitle>变更记录</CardTitle></div>
                </CardHeader>
                <CardContent>
                  {auditLoading ? (
                    <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-10 bg-muted rounded animate-pulse" />)}</div>
                  ) : !auditLogsData?.data || auditLogsData.data.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground"><History className="size-8 mx-auto mb-2 opacity-50" /><p className="text-sm">暂无变更记录</p></div>
                  ) : (
                    <Table>
                      <TableHeader><TableRow><TableHead>操作人</TableHead><TableHead>操作</TableHead><TableHead>详情</TableHead><TableHead>时间</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {auditLogsData.data.map((log: { id: string; action: string; note: string | null; operator: { name: string }; createdAt: string }) => (
                          <TableRow key={log.id}>
                            <TableCell>{log.operator?.name ?? '-'}</TableCell>
                            <TableCell><Badge variant="outline">{log.action}</Badge></TableCell>
                            <TableCell className="max-w-[400px] text-sm text-gray-600">{log.note || '-'}</TableCell>
                            <TableCell className="text-sm text-gray-500">{formatDateTime(log.createdAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            ),
          },
        ]}
      />

      {/* 申请使用弹窗 */}
      <Dialog open={usageDialogOpen} onOpenChange={setUsageDialogOpen} title="申请使用设备" description={`申请使用「${device.name}」`}
        footer={<><Button variant="outline" onClick={() => setUsageDialogOpen(false)}>取消</Button><Button onClick={handleApplyUsage} disabled={applying || !usageForm.purpose || !usageForm.startTime || !usageForm.endTime}>{applying ? '提交中...' : '提交申请'}</Button></>}
      >
        <div className="grid gap-4 py-2">
          <div className="grid gap-2"><Label>使用人</Label><Input value={userName} disabled /></div>
          <div className="grid gap-2"><Label htmlFor="detail-usage-purpose">用途 *</Label><Textarea id="detail-usage-purpose" placeholder="请说明使用用途" value={usageForm.purpose} onChange={(e) => setUsageForm((prev) => ({ ...prev, purpose: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2"><Label htmlFor="detail-usage-start">开始时间 *</Label><Input id="detail-usage-start" type="datetime-local" value={usageForm.startTime} onChange={(e) => setUsageForm((prev) => ({ ...prev, startTime: e.target.value }))} /></div>
            <div className="grid gap-2"><Label htmlFor="detail-usage-end">结束时间 *</Label><Input id="detail-usage-end" type="datetime-local" value={usageForm.endTime} onChange={(e) => setUsageForm((prev) => ({ ...prev, endTime: e.target.value }))} /></div>
          </div>
        </div>
      </Dialog>

      {/* 编辑弹窗 */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen} title="编辑设备" description="修改设备基本信息"
        footer={<><Button variant="outline" onClick={() => setEditDialogOpen(false)}>取消</Button><Button onClick={handleEditSave} disabled={editing || !editForm.name.trim()}>{editing ? <><Loader2 className="size-4 animate-spin" />保存中...</> : '保存'}</Button></>}
      >
        <div className="grid gap-4 py-2">
          <div className="grid gap-2"><Label htmlFor="edit-name">设备名称 *</Label><Input id="edit-name" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} /></div>
          <div className="grid gap-2"><Label htmlFor="edit-model">设备型号</Label><Input id="edit-model" value={editForm.model} onChange={(e) => setEditForm((f) => ({ ...f, model: e.target.value }))} /></div>
          <div className="grid gap-2"><Label htmlFor="edit-serial">序列号</Label><Input id="edit-serial" value={editForm.serialNumber} onChange={(e) => setEditForm((f) => ({ ...f, serialNumber: e.target.value }))} /></div>
          <div className="grid gap-2"><Label htmlFor="edit-location">存放位置</Label><Input id="edit-location" value={editForm.location} onChange={(e) => setEditForm((f) => ({ ...f, location: e.target.value }))} /></div>
          <div className="grid gap-2">
            <Label>风险等级</Label>
            <Select
              value={editForm.riskLevel}
              onChange={(v: string) => setEditForm((f) => ({ ...f, riskLevel: v }))}
              placeholder="风险等级"
              options={[
                { value: 'LOW', label: '低风险' },
                { value: 'MEDIUM', label: '中风险' },
                { value: 'HIGH', label: '高风险' },
                { value: 'CRITICAL', label: '极高风险' },
              ]}
            />
          </div>
        </div>
      </Dialog>

      {/* 报废确认弹窗 */}
      <Dialog open={scrapDialogOpen} onOpenChange={setScrapDialogOpen} title="确认报废设备" description={`将设备「${device.name}」标记为报废，此操作不可撤销`}
        footer={<><Button variant="outline" onClick={() => setScrapDialogOpen(false)}>取消</Button><Button variant="destructive" onClick={handleScrap} disabled={scrapping || !scrapReason.trim()}>{scrapping ? <><Loader2 className="size-4 animate-spin" />处理中...</> : '确认报废'}</Button></>}
      >
        <div className="py-2 space-y-3">
          <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">报废后：</p>
              <ul className="mt-1 list-disc list-inside space-y-0.5 text-red-600">
                <li>设备状态变为「已报废」，不可再编辑或预约</li>
                <li>所有未来预约将被自动取消</li>
                <li>活跃使用记录将被终止</li>
                <li>操作将记录到审计日志</li>
              </ul>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="scrap-reason">报废原因 *</Label>
            <Textarea id="scrap-reason" placeholder="请输入报废原因（如：设备老化、无法维修、达到使用年限等）" value={scrapReason} onChange={(e) => setScrapReason(e.target.value)} rows={3} />
          </div>
        </div>
      </Dialog>

      {/* 状态变更弹窗 */}
      <Dialog
        open={statusDialogOpen}
        onOpenChange={setStatusDialogOpen}
        title="变更设备状态"
        description={statusTargetNew ? `确认将「${device.name}」状态变更为「${({ IDLE: '空闲', MAINTENANCE: '维护中', DISABLED: '已停用' } as Record<string, string>)[statusTargetNew] ?? statusTargetNew}」` : ''}
        footer={<><Button variant="outline" onClick={() => setStatusDialogOpen(false)} disabled={statusChanging}>取消</Button><Button onClick={handleStatusChange} disabled={statusChanging}>{statusChanging ? '变更中...' : '确认变更'}</Button></>}
      >
        <div className="grid gap-4 py-2">
          {device.status === 'IN_USE' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              ⚠️ 该设备当前正在使用中，变更状态将终止所有活跃使用记录，使用人将被记录为“管理员终止”。
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="detail-status-reason">变更原因（可选）</Label>
            <Textarea
              id="detail-status-reason"
              placeholder="请输入变更原因，便于审计追踪"
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
              rows={3}
            />
          </div>
        </div>
      </Dialog>
    </div>
  );
}
