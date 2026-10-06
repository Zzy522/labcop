'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  Cpu,
  Info,
  MapPin,
  ListFilter,
  Search,
  Settings,
  User,
  X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import WeekScheduler from '@/components/booking/week-scheduler';
import { authFetch } from '@/lib/auth-fetch';

type ReservationStatus = 'PENDING' | 'APPROVED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'REJECTED';
type ActiveReservationStatus = Extract<ReservationStatus, 'PENDING' | 'APPROVED' | 'ACTIVE'>;
type DeviceFilter = 'ALL' | 'IDLE' | 'MINE' | 'HIGH_RISK' | 'IN_USE' | 'UNAVAILABLE';

const primaryFilters: Array<{ value: DeviceFilter; label: string }> = [
  { value: 'ALL', label: '全部设备' },
  { value: 'IDLE', label: '当前空闲' },
  { value: 'MINE', label: '我的预约' },
  { value: 'HIGH_RISK', label: '高风险设备' },
];

const moreFilters: Array<{ value: DeviceFilter; label: string }> = [
  { value: 'IN_USE', label: '使用中设备' },
  { value: 'UNAVAILABLE', label: '维护、停用与报废' },
];

interface DeviceItem {
  id: string;
  name: string;
  model?: string | null;
  status: 'IDLE' | 'IN_USE' | 'MAINTENANCE' | 'DISABLED' | 'SCRAPPED';
  location?: string | null;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  lab?: { name: string };
  deviceUsages?: Array<{
    startTime: string;
    endTime: string | null;
    user?: { name: string } | null;
  }>;
  reservations?: Array<{
    startTime: string;
    endTime: string;
    user?: { name: string } | null;
  }>;
}

interface MyReservation {
  id: string;
  deviceId: string;
  startTime: string;
  endTime: string;
  purpose?: string | null;
  status: ReservationStatus;
}

interface ActiveMyReservation extends MyReservation {
  status: ActiveReservationStatus;
}

const riskLabels: Record<DeviceItem['riskLevel'], { label: string; className: string }> = {
  LOW: { label: '普通设备', className: 'bg-[#34C759]/10 text-[#34C759]' },
  MEDIUM: { label: '中风险', className: 'bg-[#FF9500]/10 text-[#FF9500]' },
  HIGH: { label: '高风险', className: 'bg-[#FF3B30]/10 text-[#FF3B30]' },
  CRITICAL: { label: '高风险', className: 'bg-[#FF3B30]/10 text-[#FF3B30]' },
};

const reservationLabels: Record<ActiveReservationStatus, { label: string; className: string }> = {
  PENDING: { label: '待审批', className: 'border-[#FF9500]/20 bg-[#FF9500]/10 text-[#FF9500]' },
  APPROVED: { label: '已预约', className: 'border-[#007AFF]/20 bg-[#007AFF]/10 text-[#007AFF]' },
  ACTIVE: { label: '使用中', className: 'border-[#34C759]/20 bg-[#34C759]/10 text-[#34C759]' },
};

function pad(value: number) {
  return value.toString().padStart(2, '0');
}

function formatTime(dateTime: string | null | undefined) {
  if (!dateTime) return '进行中';
  const date = new Date(dateTime);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatReservationRange(startTime: string, endTime: string) {
  const start = new Date(startTime);
  return `${start.getMonth() + 1}月${start.getDate()}日 ${formatTime(startTime)} - ${formatTime(endTime)}`;
}

function isActiveReservation(reservation: MyReservation, currentTime: number | null): reservation is ActiveMyReservation {
  return ['PENDING', 'APPROVED', 'ACTIVE'].includes(reservation.status) && (currentTime === null || new Date(reservation.endTime).getTime() > currentTime);
}

function RiskBadge({ level, className = '' }: { level: DeviceItem['riskLevel']; className?: string }) {
  const info = riskLabels[level];
  const Icon = level === 'LOW' ? CheckCircle2 : AlertTriangle;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide ${info.className} ${className}`}>
      <Icon className="size-3" strokeWidth={2.5} />
      {info.label}
    </span>
  );
}

function StatusPanel({
  icon,
  iconClassName,
  panelClassName,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  iconClassName: string;
  panelClassName: string;
  title: string;
  subtitle: ReactNode;
}) {
  return (
    <div className={`flex items-center gap-2.5 rounded-2xl p-2.5 transition-colors ${panelClassName}`}>
      <div className={`flex size-9 shrink-0 items-center justify-center rounded-full ${iconClassName}`}>{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold text-gray-900">{title}</p>
        <div className="mt-0.5 flex items-center gap-1 truncate text-[13px] text-gray-500">{subtitle}</div>
      </div>
    </div>
  );
}

function GlobalStatus({ device }: { device: DeviceItem }) {
  const unavailable = device.status === 'MAINTENANCE' || device.status === 'DISABLED' || device.status === 'SCRAPPED';
  if (unavailable) {
    const title = device.status === 'MAINTENANCE' ? '设备维护中' : device.status === 'DISABLED' ? '设备已停用' : '设备已报废';
    return <StatusPanel icon={<Settings className="size-5" />} iconClassName="bg-gray-200 text-gray-600" panelClassName="bg-gray-100/80" title={title} subtitle="暂时无法使用及新增预约" />;
  }

  if (device.status === 'IN_USE') {
    const usage = device.deviceUsages?.[0];
    return <StatusPanel icon={<User className="size-5" />} iconClassName="bg-[#FF9500]/15 text-[#FF9500]" panelClassName="bg-[#FF9500]/5" title={`使用中: ${usage?.user?.name || '实验室成员'}`} subtitle={<><Clock className="size-3" />预计结束: {formatTime(usage?.endTime)}</>} />;
  }

  const upcoming = device.reservations?.[0];
  if (upcoming) {
    return <StatusPanel icon={<User className="size-5" />} iconClassName="bg-[#FFCC00]/15 text-[#D8A900]" panelClassName="bg-[#FFCC00]/5" title={`即将使用: ${upcoming.user?.name || '实验室成员'}`} subtitle={<><Calendar className="size-3" />预约开始: {formatReservationRange(upcoming.startTime, upcoming.endTime)}</>} />;
  }

  return <StatusPanel icon={<CheckCircle2 className="size-5" />} iconClassName="bg-[#34C759]/15 text-[#34C759]" panelClassName="bg-[#34C759]/5" title="当前空闲" subtitle="设备未被占用，可以立即预约" />;
}

function MyBookings({ bookings, onManage }: { bookings: ActiveMyReservation[]; onManage: () => void }) {
  const latestBooking = bookings[0];
  if (!latestBooking) {
    return (
      <section className="mt-3">
        <h3 className="px-1 text-xs font-semibold tracking-wide text-gray-400">我的预约</h3>
        <p className="px-1 py-2 text-[14px] text-gray-400">您暂无有效预约</p>
      </section>
    );
  }

  const status = reservationLabels[latestBooking.status];
  return (
    <section className="mt-3">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <h3 className="text-xs font-semibold tracking-wide text-gray-400">我的预约</h3>
        {bookings.length > 1 && <span className="rounded-full bg-[#007AFF]/10 px-2 py-0.5 text-[12px] font-semibold text-[#007AFF]">共 {bookings.length} 条</span>}
      </div>
      <button type="button" onClick={onManage} className="group w-full rounded-2xl border border-gray-100/80 bg-white p-3 text-left shadow-[0_2px_10px_rgba(0,0,0,0.02)] transition-all hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)]">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${status.className}`}>{status.label}</span>
          {bookings.length > 1 && <span className="flex shrink-0 items-center text-[13px] font-medium text-gray-400 transition-colors group-hover:text-[#007AFF]">展开全部 <ChevronRight className="ml-0.5 size-4" /></span>}
        </div>
        <p className="flex items-center gap-1.5 text-[15px] font-semibold text-gray-900"><Calendar className="size-4 text-[#007AFF]" />{formatReservationRange(latestBooking.startTime, latestBooking.endTime)}</p>
        <p className="mt-1 truncate pl-5 text-[13px] text-gray-500" title={latestBooking.purpose || undefined}>用途: {latestBooking.purpose || '未填写用途'}</p>
      </button>
    </section>
  );
}

export default function EquipmentApplyPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [bookingDevice, setBookingDevice] = useState<DeviceItem | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState<number | null>(null);
  const [deviceFilter, setDeviceFilter] = useState<DeviceFilter>('ALL');
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);

  useEffect(() => {
    const refreshCurrentTime = () => setCurrentTime(Date.now());
    refreshCurrentTime();
    const intervalId = window.setInterval(refreshCurrentTime, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const { data, isLoading, isError, refetch: refetchDevices } = useQuery<{ data: DeviceItem[] }>({
    queryKey: ['devices', search],
    queryFn: async () => {
      const params = new URLSearchParams({ pageSize: '100' });
      if (search) params.set('search', search);
      const res = await authFetch(`/api/devices?${params.toString()}`);
      if (!res.ok) throw new Error('获取设备列表失败');
      return res.json();
    },
  });

  const { data: reservationData, refetch: refetchMyReservations } = useQuery<{ data: MyReservation[] }>({
    queryKey: ['my-device-reservations'],
    queryFn: async () => {
      const res = await authFetch('/api/reservations/mine');
      if (!res.ok) throw new Error('获取我的预约失败');
      return res.json();
    },
  });

  const devices = data?.data ?? [];
  const futureBookingsByDevice = new Map<string, ActiveMyReservation[]>();
  for (const reservation of reservationData?.data ?? []) {
    if (!isActiveReservation(reservation, currentTime)) continue;
    const bookings = futureBookingsByDevice.get(reservation.deviceId) ?? [];
    bookings.push(reservation);
    futureBookingsByDevice.set(reservation.deviceId, bookings);
  }
  for (const bookings of futureBookingsByDevice.values()) {
    bookings.sort((a, b) => {
      const aIsActive = a.status === 'ACTIVE';
      const bIsActive = b.status === 'ACTIVE';
      if (aIsActive !== bIsActive) return aIsActive ? -1 : 1;
      return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    });
  }

  // 设备清单以同一设备接口为唯一来源，管理员与实验员看到并操作的是同一批设备。
  const displayDevices = devices;
  const filteredDevices = displayDevices.filter((device) => {
    const hasMyBooking = (futureBookingsByDevice.get(device.id)?.length ?? 0) > 0;
    if (deviceFilter === 'IDLE') return device.status === 'IDLE';
    if (deviceFilter === 'MINE') return hasMyBooking;
    if (deviceFilter === 'HIGH_RISK') return device.riskLevel === 'HIGH' || device.riskLevel === 'CRITICAL';
    if (deviceFilter === 'IN_USE') return device.status === 'IN_USE';
    if (deviceFilter === 'UNAVAILABLE') return ['MAINTENANCE', 'DISABLED', 'SCRAPPED'].includes(device.status);
    return true;
  });

  const openBooking = useCallback((device: DeviceItem) => {
    setBookingDevice(device);
    setBookingOpen(true);
  }, []);

  const closeBooking = useCallback(() => {
    setBookingOpen(false);
    setBookingDevice(null);
  }, []);

  const canBook = (status: DeviceItem['status']) => !['MAINTENANCE', 'DISABLED', 'SCRAPPED'].includes(status);
  const manageBookings = useCallback(() => router.push('/user/applications'), [router]);

  return (
    <div className="space-y-6">
      <div className="space-y-6">
        <div className="flex items-start gap-3 rounded-2xl border border-blue-100 bg-blue-50/60 px-5 py-4 text-[15px] leading-7 text-slate-600">
          <Info className="mt-0.5 size-5 shrink-0 text-[#007AFF]" />
          <p><span className="font-semibold text-slate-900">排期规则更新：</span>卡片现已独立展示“当前设备状态”与“我的预约”；设备被他人使用时，您仍可预约未来空闲时段；同一设备允许多条不冲突的预约记录。</p>
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
            <Input placeholder="搜索设备名称或型号..." value={search} onChange={(event) => setSearch(event.target.value)} className="h-11 rounded-full border-white bg-white pl-9 shadow-sm" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {primaryFilters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => { setDeviceFilter(filter.value); setMoreFiltersOpen(false); }}
                className={`h-10 rounded-full border px-4 text-sm font-medium transition-colors ${deviceFilter === filter.value ? 'border-[#111827] bg-[#111827] text-white shadow-sm' : 'border-[#E5E7EB] bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900'}`}
              >
                {filter.label}
              </button>
            ))}
            <div className="relative">
              <button
                type="button"
                aria-expanded={moreFiltersOpen}
                onClick={() => setMoreFiltersOpen((open) => !open)}
                className={`flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors ${moreFilters.some((filter) => filter.value === deviceFilter) ? 'border-[#111827] bg-[#111827] text-white shadow-sm' : 'border-[#E5E7EB] bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900'}`}
              >
                <ListFilter className="size-4" />更多筛选
              </button>
              {moreFiltersOpen && (
                <div className="absolute left-0 z-20 mt-2 w-48 rounded-2xl border border-gray-100 bg-white p-2 shadow-xl">
                  {moreFilters.map((filter) => (
                    <button key={filter.value} type="button" onClick={() => { setDeviceFilter(filter.value); setMoreFiltersOpen(false); }} className={`w-full rounded-xl px-3 py-2 text-left text-sm transition-colors ${deviceFilter === filter.value ? 'bg-[#007AFF]/10 font-semibold text-[#007AFF]' : 'text-gray-600 hover:bg-gray-50'}`}>{filter.label}</button>
                  ))}
                  <button type="button" onClick={() => { setDeviceFilter('ALL'); setMoreFiltersOpen(false); }} className="mt-1 w-full rounded-xl border-t border-gray-100 px-3 py-2 text-left text-sm text-gray-400 transition-colors hover:bg-gray-50">清除筛选</button>
                </div>
              )}
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => <Card key={index} className="h-[430px] animate-pulse border-white bg-white"><CardContent className="space-y-5 p-6"><div className="h-7 w-2/3 rounded bg-gray-100" /><div className="h-20 rounded-2xl bg-gray-100" /><div className="h-28 rounded-2xl bg-gray-100" /></CardContent></Card>)}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-gray-500">
            <Cpu className="mb-4 size-12 text-gray-300" />
            <p className="text-lg font-medium text-gray-700">设备列表加载失败</p>
            <p className="mt-1 text-sm">请检查网络或稍后重试</p>
            <Button variant="outline" className="mt-4" onClick={() => void refetchDevices()}>重新加载</Button>
          </div>
        ) : filteredDevices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-gray-500"><Cpu className="mb-4 size-12 text-gray-300" /><p className="text-lg font-medium text-gray-700">暂无匹配设备</p><p className="mt-1 text-sm">请调整搜索或筛选条件</p></div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
            {filteredDevices.map((device) => {
              const bookings = futureBookingsByDevice.get(device.id) ?? [];
              const bookingEnabled = canBook(device.status);
              return (
                <Card key={device.id} className="flex min-h-[380px] flex-col overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-shadow hover:shadow-[0_12px_40px_rgb(0,0,0,0.08)]">
                  <CardHeader className="flex-1 space-y-0 p-5 pb-3 pt-6 sm:p-5 sm:pb-3 sm:pt-6">
                    <div className="flex w-full items-start gap-4">
                      <div className="min-w-0">
                        <CardTitle className="truncate text-lg font-semibold leading-6 tracking-tight text-gray-900" title={device.name}>{device.name}</CardTitle>
                        <CardDescription className="mt-1.5 font-mono text-[13px] tracking-wide text-gray-500" title={device.model || undefined}>{device.model || '未填写型号'}</CardDescription>
                      </div>
                      <RiskBadge level={device.riskLevel} className="ml-auto" />
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5 text-[13px] text-gray-400"><MapPin className="size-3.5" />{device.location || '未指定位置'}</div>
                    <div className="my-3.5 border-t border-gray-100" />
                    <section>
                      <h3 className="mb-1.5 px-1 text-xs font-semibold tracking-wide text-gray-400">当前占用情况</h3>
                      <GlobalStatus device={device} />
                    </section>
                    <MyBookings bookings={bookings} onManage={manageBookings} />
                  </CardHeader>
                  <CardContent className="flex items-center gap-3 bg-white px-5 pb-4 pt-1 sm:px-5 sm:pb-5">
                    {bookings.length > 0 && <Button variant="outline" className="h-11 flex-1 rounded-2xl border-0 bg-[#007AFF]/10 text-sm font-semibold text-[#007AFF] hover:bg-[#007AFF]/15" onClick={manageBookings}>管理预约</Button>}
                    <Button disabled={!bookingEnabled} className="h-11 rounded-2xl bg-[#007AFF] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[#0066CC] disabled:bg-gray-100 disabled:text-gray-400" style={{ flex: bookings.length > 0 ? 1.5 : 1 }} onClick={() => openBooking(device)}>查看并预约</Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {bookingOpen && bookingDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-[95vw] flex-col overflow-hidden rounded-2xl border border-white/20 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 bg-slate-50/80 p-5">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-bold text-gray-800"><Calendar className="size-5 text-[#007AFF]" />设备预约排期</h2>
                <p className="mt-1 text-sm text-gray-500">当前设备：<span className="font-medium text-[#007AFF]">{bookingDevice.name}</span></p>
              </div>
              <button type="button" aria-label="关闭预约排期" className="rounded-full border border-gray-100 bg-white p-2 text-gray-400 shadow-sm transition-colors hover:bg-gray-100 hover:text-gray-700" onClick={closeBooking}><X className="size-5" /></button>
            </div>
            <div className="flex-1 overflow-auto p-5"><WeekScheduler deviceId={bookingDevice.id} deviceName={bookingDevice.name} deviceRiskLevel={bookingDevice.riskLevel} demoMode={false} onReservationChanged={() => void refetchMyReservations()} /></div>
            <div className="flex justify-end border-t border-gray-100 bg-slate-50/80 p-4"><Button variant="outline" onClick={closeBooking}>关闭</Button></div>
          </div>
        </div>
      )}
    </div>
  );
}
