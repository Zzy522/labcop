'use client';

/**
 * 设备使用 + 预约 甘特总览（只读）
 *
 * 在一条横向时间轴上同时可视化：
 *  - 设备使用记录（DeviceUsage，绿色系）
 *  - 设备预约（Reservation，按状态着色）
 * 管理员可在设备详情页一览近 7 天历史与未来 7 天排期。
 */
import { useState, useCallback, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, ChevronLeft, ChevronRight, CalendarRange } from 'lucide-react';
import { format, addDays, startOfDay, differenceInMilliseconds } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { authFetch } from '@/lib/auth-fetch';
import { cn } from '@/lib/utils';

// ============ 类型 ============
interface UsageItem {
  id: string;
  userId: string;
  startTime: string;
  endTime: string | null;
  purpose?: string | null;
  status: string; // NORMAL | COMPLETED | ABNORMAL
  user?: { id: string; name: string };
}

interface ReservationItem {
  id: string;
  userId: string;
  userName: string;
  startTime: string;
  endTime: string;
  purpose?: string | null;
  status: 'PENDING' | 'APPROVED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'REJECTED';
}

interface DeviceGanttProps {
  deviceId: string;
  /** 外部触发刷新（与 WeekScheduler 共用信号） */
  refreshSignal?: number;
}

// ============ 常量 ============
const WINDOW_DAYS = 14; // 总窗口：过去 7 天 + 未来 7 天
const HALF = 7;

const usageColors: Record<string, string> = {
  NORMAL: 'bg-gradient-to-r from-emerald-400 to-green-500',
  COMPLETED: 'bg-gradient-to-r from-slate-300 to-slate-400',
  ABNORMAL: 'bg-gradient-to-r from-red-400 to-rose-500',
};

const usageLabels: Record<string, string> = {
  NORMAL: '使用中',
  COMPLETED: '已完成',
  ABNORMAL: '异常',
};

const reservationColors: Record<ReservationItem['status'], string> = {
  PENDING: 'bg-gradient-to-r from-amber-400 to-orange-500',
  APPROVED: 'bg-gradient-to-r from-sky-400 to-blue-500',
  ACTIVE: 'bg-gradient-to-r from-emerald-400 to-green-500',
  COMPLETED: 'bg-gradient-to-r from-slate-300 to-slate-400',
  CANCELLED: 'bg-gradient-to-r from-slate-200 to-slate-300 opacity-50',
  REJECTED: 'bg-gradient-to-r from-red-300 to-rose-400 opacity-60',
};

const reservationLabels: Record<ReservationItem['status'], string> = {
  PENDING: '待审批',
  APPROVED: '已通过',
  ACTIVE: '使用中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  REJECTED: '已拒绝',
};

// ============ 工具 ============
function fmtTime(iso: string) {
  try {
    return format(new Date(iso), 'MM-dd HH:mm');
  } catch {
    return iso;
  }
}

/** 计算某时刻在窗口中的百分比位置（0-100），越界自动夹断 */
function posPct(time: Date, rangeStart: Date, totalMs: number) {
  const diff = differenceInMilliseconds(time, rangeStart);
  return (diff / totalMs) * 100;
}

// ============ 主组件 ============
export default function DeviceGantt({ deviceId, refreshSignal = 0 }: DeviceGanttProps) {
  // 窗口中心日（默认今天）；窗口 = [中心-7, 中心+7)
  const [centerDate, setCenterDate] = useState<Date>(() => startOfDay(new Date()));
  const [usages, setUsages] = useState<UsageItem[]>([]);
  const [reservations, setReservations] = useState<ReservationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rangeStart = useMemo(() => startOfDay(addDays(centerDate, -HALF)), [centerDate]);
  const rangeEnd = useMemo(() => addDays(rangeStart, WINDOW_DAYS), [rangeStart]);
  const totalMs = WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const dayColumns = useMemo(() => {
    return Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(rangeStart, i));
  }, [rangeStart]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [resRes, useRes] = await Promise.all([
        authFetch(
          `/api/devices/${deviceId}/reservations?startDate=${encodeURIComponent(
            rangeStart.toISOString()
          )}&endDate=${encodeURIComponent(rangeEnd.toISOString())}`
        ),
        authFetch(`/api/devices/${deviceId}/usage`),
      ]);
      if (!resRes.ok) throw new Error('加载预约失败');
      if (!useRes.ok) throw new Error('加载使用记录失败');
      const resJson = await resRes.json();
      const useJson = await useRes.json();
      setReservations((resJson.data ?? []) as ReservationItem[]);
      setUsages((useJson ?? []) as UsageItem[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [deviceId, rangeStart, rangeEnd]);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchData, refreshSignal]);

  // 过滤出与窗口有交集的条目
  const visibleReservations = useMemo(
    () =>
      reservations.filter((r) => {
        const s = new Date(r.startTime);
        const e = new Date(r.endTime);
        return s < rangeEnd && e > rangeStart;
      }),
    [reservations, rangeStart, rangeEnd]
  );

  const visibleUsages = useMemo(
    () =>
      usages.filter((u) => {
        const s = new Date(u.startTime);
        const e = u.endTime ? new Date(u.endTime) : new Date(); // 进行中的使用记录延伸到“现在”
        return s < rangeEnd && e > rangeStart;
      }),
    [usages, rangeStart, rangeEnd]
  );

  const todayPct = useMemo(() => {
    const now = new Date();
    if (now < rangeStart || now > rangeEnd) return null;
    return posPct(now, rangeStart, totalMs);
  }, [rangeStart, rangeEnd, totalMs]);

  // 渲染单个条形
  const renderBar = (
    item: { id: string; startTime: string; endTime: string | null; purpose?: string | null },
    label: string,
    color: string,
    statusLabel: string
  ) => {
    const s = new Date(item.startTime);
    const e = item.endTime ? new Date(item.endTime) : new Date();
    let leftPct = posPct(s, rangeStart, totalMs);
    let rightPct = posPct(e, rangeStart, totalMs);
    // 夹断到窗口
    leftPct = Math.max(0, leftPct);
    rightPct = Math.min(100, rightPct);
    const widthPct = rightPct - leftPct;
    if (widthPct <= 0.2) return null;
    return (
      <div
        key={item.id}
        className={cn(
          'absolute top-1 h-7 rounded-md shadow-sm text-white text-[10px] font-semibold flex items-center justify-center px-1.5 overflow-hidden border border-white/40 whitespace-nowrap',
          color
        )}
        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
        title={`${label} · ${statusLabel}\n${fmtTime(item.startTime)} - ${item.endTime ? fmtTime(item.endTime) : '进行中'}${item.purpose ? '\n用途：' + item.purpose : ''}`}
      >
        {widthPct > 4 ? <span className="truncate drop-shadow-sm">{label}</span> : null}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCenterDate((d) => addDays(d, -7))}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-xs font-semibold min-w-[200px] text-center text-gray-700">
            {format(rangeStart, 'yyyy-MM-dd', { locale: zhCN })} ~ {format(addDays(rangeEnd, -1), 'yyyy-MM-dd', { locale: zhCN })}
          </span>
          <Button variant="outline" size="sm" onClick={() => setCenterDate((d) => addDays(d, 7))}>
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCenterDate(startOfDay(new Date()))}>
            回到本周
          </Button>
        </div>
        {/* 图例 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-600">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gradient-to-r from-emerald-400 to-green-500" />使用中</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gradient-to-r from-slate-300 to-slate-400" />已完成使用</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gradient-to-r from-amber-400 to-orange-500" />待审批</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gradient-to-r from-sky-400 to-blue-500" />已通过</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gradient-to-r from-red-400 to-rose-500" />异常/拒绝</span>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-gray-400">
          <Loader2 className="size-5 animate-spin mr-2" />
          <span className="text-sm">加载甘特数据...</span>
        </div>
      ) : error ? (
        <div className="py-8 text-center text-sm text-red-500">{error}</div>
      ) : visibleUsages.length === 0 && visibleReservations.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400 flex flex-col items-center gap-1">
          <CalendarRange className="size-7 opacity-40" />
          <span>该时间窗口内暂无使用记录与预约</span>
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white">
          <div className="min-w-[760px]">
            {/* 日期表头 */}
            <div className="relative h-9 border-b border-gray-200 bg-slate-50">
              {dayColumns.map((d, i) => {
                const isToday = format(d, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                return (
                  <div
                    key={i}
                    className={cn(
                      'absolute top-0 bottom-0 border-l border-gray-200 flex flex-col items-center justify-center text-[10px] leading-tight',
                      isToday ? 'bg-blue-50' : isWeekend ? 'bg-amber-50/40' : ''
                    )}
                    style={{ left: `${(i / WINDOW_DAYS) * 100}%`, width: `${100 / WINDOW_DAYS}%` }}
                  >
                    <span className={cn('font-bold', isToday ? 'text-blue-600' : 'text-gray-700')}>{format(d, 'EEE', { locale: zhCN })}</span>
                    <span className={cn('text-[9px]', isToday ? 'text-blue-500' : 'text-gray-500')}>{format(d, 'MM-dd')}</span>
                  </div>
                );
              })}
            </div>

            {/* 甘特主体 */}
            <div className="relative">
              {/* 垂直网格线 + 今日竖线 */}
              <div className="absolute inset-0 pointer-events-none">
                {dayColumns.map((_, i) => (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 border-l border-gray-100"
                    style={{ left: `${(i / WINDOW_DAYS) * 100}%` }}
                  />
                ))}
                {todayPct !== null && (
                  <div
                    className="absolute top-0 bottom-0 border-l-2 border-dashed border-blue-400/70"
                    style={{ left: `${todayPct}%` }}
                    title="现在"
                  />
                )}
              </div>

              {/* 使用记录泳道 */}
              <div className="relative h-10 border-b border-gray-100">
                <div className="absolute left-1 top-1 z-10 text-[10px] font-semibold text-gray-400 bg-white/70 px-1 rounded">使用记录</div>
                {visibleUsages.map((u) =>
                  renderBar(
                    u,
                    u.user?.name ?? '用户',
                    usageColors[u.status] ?? usageColors.NORMAL,
                    usageLabels[u.status] ?? u.status
                  )
                )}
                {visibleUsages.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center text-[11px] text-gray-300">无使用记录</div>
                )}
              </div>

              {/* 预约泳道 */}
              <div className="relative h-10">
                <div className="absolute left-1 top-1 z-10 text-[10px] font-semibold text-gray-400 bg-white/70 px-1 rounded">预约</div>
                {visibleReservations.map((r) =>
                  renderBar(
                    r,
                    r.userName,
                    reservationColors[r.status] ?? reservationColors.APPROVED,
                    reservationLabels[r.status] ?? r.status
                  )
                )}
                {visibleReservations.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center text-[11px] text-gray-300">无预约</div>
                )}
              </div>
            </div>

            {/* 今日标签 */}
            {todayPct !== null && (
              <div className="relative h-5">
                <div
                  className="absolute top-0 -translate-x-1/2 text-[9px] text-blue-500 font-semibold"
                  style={{ left: `${todayPct}%` }}
                >
                  现在
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <p className="text-[11px] text-gray-400">
        提示：甘特图按天分列，上方泳道为设备使用记录，下方泳道为预约；虚线为当前时刻。左右切换可查看更早或更晚的排期。
      </p>
    </div>
  );
}
