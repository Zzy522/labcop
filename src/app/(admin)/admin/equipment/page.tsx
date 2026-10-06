'use client';

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, MapPin, Pencil, Plus, Search, Settings, User, Wrench, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Select } from '@/arco-adapters/select';
import { Dialog } from '@/arco-adapters/dialog';
import { DropdownMenu } from '@/arco-adapters/dropdown';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import type { Device, DeviceQueryParams, CreateDeviceRequest, CreateDeviceUsageRequest } from './types';
import { authFetch } from '@/lib/auth-fetch';
import { useAuthStore } from '@/store/auth-store';

const statusConfig: Record<Device['status'], { label: string; detail: string; panelClassName: string; iconClassName: string; Icon: LucideIcon }> = {
  IDLE: { label: '当前空闲', detail: '设备未被占用，可申请使用', panelClassName: 'bg-[#34C759]/5', iconClassName: 'bg-[#34C759]/15 text-[#34C759]', Icon: CheckCircle2 },
  IN_USE: { label: '使用中', detail: '设备正在被占用', panelClassName: 'bg-[#FF9500]/5', iconClassName: 'bg-[#FF9500]/15 text-[#FF9500]', Icon: User },
  MAINTENANCE: { label: '设备维护中', detail: '暂时无法申请使用', panelClassName: 'bg-gray-100/80', iconClassName: 'bg-gray-200 text-gray-600', Icon: Settings },
  DISABLED: { label: '设备已停用', detail: '暂时无法申请使用', panelClassName: 'bg-gray-100/80', iconClassName: 'bg-gray-200 text-gray-600', Icon: Settings },
  SCRAPPED: { label: '设备已报废', detail: '该设备已停止使用', panelClassName: 'bg-gray-100/80', iconClassName: 'bg-gray-200 text-gray-500', Icon: Settings },
};

const riskLevelConfig: Record<Device['riskLevel'], { label: string; className: string }> = {
  LOW: { label: '普通设备', className: 'bg-[#34C759]/10 text-[#34C759]' },
  MEDIUM: { label: '中风险', className: 'bg-[#FF9500]/10 text-[#FF9500]' },
  HIGH: { label: '高风险', className: 'bg-[#FF3B30]/10 text-[#FF3B30]' },
  CRITICAL: { label: '高风险', className: 'bg-[#FF3B30]/10 text-[#FF3B30]' },
};

function RiskBadge({ level }: { level: Device['riskLevel'] }) {
  const info = riskLevelConfig[level];
  const Icon = level === 'LOW' ? CheckCircle2 : AlertTriangle;
  return (
    <span className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide ${info.className}`}>
      <Icon className="size-3" strokeWidth={2.5} />
      {info.label}
    </span>
  );
}

const statusTransitions: Record<Device['status'], Array<{ value: 'IDLE' | 'MAINTENANCE' | 'DISABLED'; label: string }>> = {
  IDLE: [{ value: 'MAINTENANCE', label: '转为维护中' }, { value: 'DISABLED', label: '停用设备' }],
  IN_USE: [{ value: 'IDLE', label: '结束使用并设为空闲' }, { value: 'MAINTENANCE', label: '终止使用并维护' }, { value: 'DISABLED', label: '终止使用并停用' }],
  MAINTENANCE: [{ value: 'IDLE', label: '维护完成，恢复空闲' }, { value: 'DISABLED', label: '停用设备' }],
  DISABLED: [{ value: 'IDLE', label: '恢复为空闲' }, { value: 'MAINTENANCE', label: '转为维护中' }],
  SCRAPPED: [],
};

async function fetchDevices(params: DeviceQueryParams) {
  const searchParams = new URLSearchParams();
  if (params.search) searchParams.set('search', params.search);
  if (params.riskLevel) searchParams.set('riskLevel', params.riskLevel);
  if (params.status) searchParams.set('status', params.status);
  if (params.page) searchParams.set('page', String(params.page));
  if (params.pageSize) searchParams.set('pageSize', String(params.pageSize));
  const res = await authFetch(`/api/devices?${searchParams.toString()}`);
  if (!res.ok) throw new Error('获取设备列表失败');
  return res.json();
}

async function createDevice(data: CreateDeviceRequest) {
  const res = await authFetch('/api/devices', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || '创建设备失败');
  }
  return res.json();
}

async function applyDeviceUsage(deviceId: string, data: CreateDeviceUsageRequest) {
  const res = await authFetch(`/api/devices/${deviceId}/usage`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || '申请使用失败');
  }
  return res.json();
}

export default function AdminEquipmentPage() {
  const userLabId = useAuthStore((s) => s.user?.labId ?? '');
  const userLabName = useAuthStore((s) => s.user?.labName ?? '当前实验室');
  const userId = useAuthStore((s) => s.user?.id ?? '');
  const userName = useAuthStore((s) => s.user?.name ?? '当前用户');
  const [search, setSearch] = useState('');
  const [riskLevel, setRiskLevel] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [page, setPage] = useState(1);
  const pageSize = 12;

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newDevice, setNewDevice] = useState<CreateDeviceRequest>({
    name: '', model: '', serialNumber: '', location: '', riskLevel: 'LOW', labId: userLabId,
  });
  const [creating, setCreating] = useState(false);

  const [usageDialogOpen, setUsageDialogOpen] = useState(false);
  const [usageDeviceId, setUsageDeviceId] = useState('');
  const [usageDeviceName, setUsageDeviceName] = useState('');
  const [usageForm, setUsageForm] = useState<CreateDeviceUsageRequest>({
    userId: userId, purpose: '', startTime: '', endTime: '',
  });
  const [applying, setApplying] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['devices', search, riskLevel, status, page],
    queryFn: () => fetchDevices({ search, riskLevel, status, page, pageSize }),
  });

  const handleCreate = useCallback(async () => {
    if (!newDevice.name.trim()) return;
    setCreating(true);
    try {
      await createDevice({ ...newDevice, labId: userLabId });
      setAddDialogOpen(false);
      setNewDevice({ name: '', model: '', serialNumber: '', location: '', riskLevel: 'LOW', labId: userLabId });
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : '创建设备失败');
    } finally {
      setCreating(false);
    }
  }, [newDevice, userLabId, refetch]);

  const openUsageDialog = useCallback((deviceId: string, deviceName: string) => {
    setUsageDeviceId(deviceId);
    setUsageDeviceName(deviceName);
    setUsageForm({ userId: userId, purpose: '', startTime: '', endTime: '' });
    setUsageDialogOpen(true);
  }, [userId]);

  const handleApplyUsage = useCallback(async () => {
    if (!usageForm.purpose || !usageForm.startTime || !usageForm.endTime) return;
    setApplying(true);
    try {
      // datetime-local 格式转 ISO 8601
      const payload = {
        ...usageForm,
        userId: userId,
        startTime: new Date(usageForm.startTime).toISOString(),
        endTime: new Date(usageForm.endTime).toISOString(),
      };
      await applyDeviceUsage(usageDeviceId, payload);
      setUsageDialogOpen(false);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : '申请使用失败');
    } finally {
      setApplying(false);
    }
  }, [usageDeviceId, usageForm, userId, refetch]);

  // 状态变更弹窗
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [statusTargetDevice, setStatusTargetDevice] = useState<{ id: string; name: string; currentStatus: string } | null>(null);
  const [statusTargetNew, setStatusTargetNew] = useState('');
  const [statusReason, setStatusReason] = useState('');
  const [statusChanging, setStatusChanging] = useState(false);

  const openStatusDialog = useCallback((device: { id: string; name: string; status: string }, newStatus: string) => {
    setStatusTargetDevice({ id: device.id, name: device.name, currentStatus: device.status });
    setStatusTargetNew(newStatus);
    setStatusReason('');
    setStatusDialogOpen(true);
  }, []);

  const handleStatusChange = useCallback(async () => {
    if (!statusTargetDevice || !statusTargetNew) return;
    setStatusChanging(true);
    try {
      const res = await authFetch(`/api/devices/${statusTargetDevice.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: statusTargetNew, reason: statusReason || undefined }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || '更新失败');
      }
      setStatusDialogOpen(false);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : '更新设备状态失败');
    } finally {
      setStatusChanging(false);
    }
  }, [statusTargetDevice, statusTargetNew, statusReason, refetch]);

  const devices = data?.data ?? [];
  const totalPages = data?.pagination?.totalPages ?? 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
          <Input placeholder="搜索设备名称、型号..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="h-11 rounded-full border-white bg-white pl-9 shadow-sm" />
        </div>
        <Select
          value={riskLevel || '__all__'}
          onChange={(v: string) => { setRiskLevel(!v || v === '__all__' ? '' : v); setPage(1); }}
          placeholder="风险等级"
          options={[
            { value: '__all__', label: '全部等级' },
            { value: 'LOW', label: '低风险' },
            { value: 'MEDIUM', label: '中风险' },
            { value: 'HIGH', label: '高风险' },
            { value: 'CRITICAL', label: '极高风险' },
          ]}
          style={{ width: 140 }}
        />
        <Select
          value={status || '__all__'}
          onChange={(v: string) => { setStatus(!v || v === '__all__' ? '' : v); setPage(1); }}
          placeholder="设备状态"
          options={[
            { value: '__all__', label: '全部状态' },
            { value: 'IDLE', label: '空闲' },
            { value: 'IN_USE', label: '使用中' },
            { value: 'MAINTENANCE', label: '维护中' },
            { value: 'DISABLED', label: '已停用' },
            { value: 'SCRAPPED', label: '已报废' },
          ]}
          style={{ width: 140 }}
        />
        <Button onClick={() => setAddDialogOpen(true)} className="h-9">
          <Plus className="size-4" />
          新增设备
        </Button>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader><div className="h-5 bg-muted rounded w-2/3" /><div className="h-4 bg-muted rounded w-1/2 mt-2" /></CardHeader>
              <CardContent><div className="h-4 bg-muted rounded w-full" /></CardContent>
            </Card>
          ))}
        </div>
      )}

      {isError && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Wrench className="size-12 text-muted-foreground mb-4" />
          <p className="text-lg font-medium">加载失败</p>
          <p className="text-sm text-muted-foreground mt-1">{error?.message || '请稍后重试'}</p>
          <Button variant="outline" className="mt-4" onClick={() => refetch()}>重新加载</Button>
        </div>
      )}

      {!isLoading && !isError && devices.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Wrench className="size-12 text-muted-foreground mb-4" />
          <p className="text-lg font-medium">暂无设备</p>
          <p className="text-sm text-muted-foreground mt-1">
            {search || riskLevel || status ? '未找到匹配的设备，请调整筛选条件' : '点击"新增设备"按钮添加第一台设备'}
          </p>
        </div>
      )}

      {!isLoading && !isError && devices.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {devices.map((device: Device & { lab?: { id: string; name: string } }) => {
              const statusInfo = statusConfig[device.status];
              const StatusIcon = statusInfo.Icon;
              return (
                <Card key={device.id} className="group flex h-[316px] self-start flex-col gap-0 overflow-hidden rounded-3xl border border-gray-100 bg-white py-0 shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgb(0,0,0,0.08)]">
                  <Link href={`/admin/equipment/${device.id}`} className="flex min-h-0 flex-1 flex-col">
                    <CardHeader className="flex h-[120px] shrink-0 flex-col justify-center space-y-0 p-5 pt-6">
                      <div className="flex w-full items-start gap-4">
                        <div className="min-w-0">
                          <CardTitle className="truncate text-lg font-semibold leading-6 tracking-tight text-gray-900">{device.name}</CardTitle>
                          <CardDescription className="mt-1.5 font-mono text-[13px] tracking-wide text-gray-500">{device.model || '未填写型号'}</CardDescription>
                        </div>
                        <RiskBadge level={device.riskLevel} />
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5 text-[13px] text-gray-400"><MapPin className="size-3.5" />{device.location || '未指定位置'}</div>
                    </CardHeader>
                    <CardContent className="flex min-h-0 flex-1 flex-col justify-center border-t border-gray-100 px-5 py-3">
                      <div className="space-y-2">
                        <div className={`flex items-center gap-2.5 rounded-2xl p-2.5 ${statusInfo.panelClassName}`}>
                          <div className={`flex size-9 shrink-0 items-center justify-center rounded-full ${statusInfo.iconClassName}`}><StatusIcon className="size-5" /></div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[14px] font-semibold text-gray-900">{statusInfo.label}</p>
                            <p className="mt-0.5 truncate text-[13px] text-gray-500">{statusInfo.detail}</p>
                          </div>
                        </div>
                        {device.lab && <div className="flex items-center justify-between px-0.5 text-[13px] text-gray-400"><span>所属实验室</span><span className="ml-3 truncate text-sm font-medium text-gray-700">{device.lab.name}</span></div>}
                      </div>
                    </CardContent>
                  </Link>
                  <CardFooter className="h-[68px] shrink-0 justify-center gap-2 border-t border-gray-100 bg-white px-5 py-3">
                    <Button variant="outline" size="sm" className="h-10 flex-1 rounded-2xl border-0 bg-[#007AFF]/10 text-sm font-semibold text-[#007AFF] hover:bg-[#007AFF]/15" onClick={() => openUsageDialog(device.id, device.name)}>申请使用</Button>
                    <DropdownMenu
                      trigger={<Button variant="outline" size="sm" className="h-10 rounded-2xl border-gray-200 px-4">状态流转</Button>}
                      items={statusTransitions[device.status].map((transition) => ({ key: transition.value, label: transition.label, onClick: () => openStatusDialog({ id: device.id, name: device.name, status: device.status }, transition.value) }))}
                    />
                    <Link href={`/admin/equipment/${device.id}`}>
                      <Button variant="outline" size="sm" className="h-10 rounded-2xl border-gray-200 px-3 text-gray-600" aria-label={`编辑 ${device.name}`}>
                        <Pencil className="size-4" />
                        编辑
                      </Button>
                    </Link>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>上一页</Button>
              <span className="text-sm text-muted-foreground">第 {page} / {totalPages} 页</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
            </div>
          )}
        </>
      )}

      {/* 新增设备弹窗 */}
      <Dialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        title="新增设备"
        description="填写设备信息以添加新设备"
        footer={
          <>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={creating || !newDevice.name.trim()}>
              {creating ? '创建中...' : '创建'}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 py-2">
          <div className="grid gap-2"><Label htmlFor="device-name">设备名称 *</Label><Input id="device-name" placeholder="请输入设备名称" value={newDevice.name} onChange={(e) => setNewDevice((prev) => ({ ...prev, name: e.target.value }))} /></div>
          <div className="grid gap-2"><Label htmlFor="device-model">设备型号</Label><Input id="device-model" placeholder="请输入设备型号" value={newDevice.model ?? ''} onChange={(e) => setNewDevice((prev) => ({ ...prev, model: e.target.value }))} /></div>
          <div className="grid gap-2"><Label htmlFor="device-serial">序列号</Label><Input id="device-serial" placeholder="请输入序列号" value={newDevice.serialNumber ?? ''} onChange={(e) => setNewDevice((prev) => ({ ...prev, serialNumber: e.target.value }))} /></div>
          <div className="grid gap-2"><Label htmlFor="device-location">存放位置</Label><Input id="device-location" placeholder="请输入存放位置" value={newDevice.location ?? ''} onChange={(e) => setNewDevice((prev) => ({ ...prev, location: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2"><Label>风险等级</Label><Select value={newDevice.riskLevel ?? 'LOW'} onChange={(v: string) => setNewDevice((prev) => ({ ...prev, riskLevel: v as Device['riskLevel'] }))} placeholder="风险等级" options={[{ value: 'LOW', label: '低风险' }, { value: 'MEDIUM', label: '中风险' }, { value: 'HIGH', label: '高风险' }, { value: 'CRITICAL', label: '极高风险' }]} /></div>
            <div className="grid gap-2"><Label>所属实验室</Label><Input value={userLabName} disabled /></div>
          </div>
        </div>
      </Dialog>

      {/* 申请使用弹窗 */}
      <Dialog
        open={usageDialogOpen}
        onOpenChange={setUsageDialogOpen}
        title="申请使用设备"
        description={`申请使用「${usageDeviceName}」`}
        footer={
          <>
            <Button variant="outline" onClick={() => setUsageDialogOpen(false)}>取消</Button>
            <Button onClick={handleApplyUsage} disabled={applying || !usageForm.purpose || !usageForm.startTime || !usageForm.endTime}>
              {applying ? '提交中...' : '提交申请'}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 py-2">
          <div className="grid gap-2"><Label>使用人</Label><Input value={userName} disabled /></div>
          <div className="grid gap-2"><Label htmlFor="usage-purpose">用途 *</Label><Textarea id="usage-purpose" placeholder="请说明使用用途" value={usageForm.purpose} onChange={(e) => setUsageForm((prev) => ({ ...prev, purpose: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2"><Label htmlFor="usage-start">开始时间 *</Label><Input id="usage-start" type="datetime-local" value={usageForm.startTime} onChange={(e) => setUsageForm((prev) => ({ ...prev, startTime: e.target.value }))} /></div>
            <div className="grid gap-2"><Label htmlFor="usage-end">结束时间 *</Label><Input id="usage-end" type="datetime-local" value={usageForm.endTime} onChange={(e) => setUsageForm((prev) => ({ ...prev, endTime: e.target.value }))} /></div>
          </div>
        </div>
      </Dialog>

      {/* 设备状态变更弹窗 */}
      <Dialog
        open={statusDialogOpen}
        onOpenChange={setStatusDialogOpen}
        title="变更设备状态"
        description={statusTargetDevice ? `确认将「${statusTargetDevice.name}」状态变更为「${({ IDLE: '空闲', MAINTENANCE: '维护中', DISABLED: '已停用' } as Record<string, string>)[statusTargetNew] ?? statusTargetNew}」` : ''}
        footer={
          <>
            <Button variant="outline" onClick={() => setStatusDialogOpen(false)} disabled={statusChanging}>取消</Button>
            <Button onClick={handleStatusChange} disabled={statusChanging}>
              {statusChanging ? '变更中...' : '确认变更'}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 py-2">
          {statusTargetDevice?.currentStatus === 'IN_USE' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {'⚠️ 该设备当前正在使用中，变更状态将终止所有活跃使用记录，使用人将被记录为“管理员终止”。'}
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="status-reason">变更原因（可选）</Label>
            <Textarea
              id="status-reason"
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
