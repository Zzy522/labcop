'use client';

import { useState, useCallback, useEffect, useRef, useMemo, Fragment } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog } from '@/arco-adapters/dialog';
import { Loader2, ChevronLeft, ChevronRight, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { format, addDays, startOfWeek, isSameDay } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { authFetch } from '@/lib/auth-fetch';
import { useAuthStore } from '@/store/auth-store';
import { cn } from '@/lib/utils';

// ============ 类型定义 ============
export interface ReservationItem {
  id: string;
  userId: string;
  userName: string;
  startTime: string; // ISO
  endTime: string;   // ISO
  purpose?: string | null;
  fundInfo?: string | null;
  status: 'PENDING' | 'APPROVED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'REJECTED';
  note?: string | null;
}

interface WeekSchedulerProps {
  deviceId: string;
  deviceName: string;
  deviceRiskLevel?: string;
  /** 是否只读（不允许拖拽预约） */
  readOnly?: boolean;
  /** 数据刷新触发器（外部传入refetch触发） */
  refreshSignal?: number;
  /** 预约创建或取消后通知外层刷新关联信息 */
  onReservationChanged?: () => void;
  /** 演示模式：预约仅保存在当前页面，不请求后端接口 */
  demoMode?: boolean;
}

// ============ 时间常量 ============
// 24h 可预约：0:00 - 24:00，每 30 分钟一个时段
const START_HOUR = 0;
const END_HOUR = 24;
const SLOT_MINUTES = 30;
const SLOTS_PER_DAY = ((END_HOUR - START_HOUR) * 60) / SLOT_MINUTES; // 48
const SLOT_WIDTH = 28; // px；保留横向滚动，避免时间刻度与预约块过于拥挤
const ROW_HEIGHT = 58; // px
const LABEL_WIDTH = 80; // px
// 最大可预约日期 = 今天 + 3 天（当天6月1日 → 最多预约6月4日）
const MAX_BOOK_DAYS_AHEAD = 3;

// 时间选项（每30分钟一个，从8:00到22:30，共29个选项）
const timeOptions: string[] = [];
for (let i = 0; i <= SLOTS_PER_DAY; i++) {
  const h = Math.floor((i * SLOT_MINUTES) / 60) + START_HOUR;
  const m = (i * SLOT_MINUTES) % 60;
  timeOptions.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
}

// 关联基金/课题选项
const FUND_OPTIONS = [
  '国自然',
  '国家重点研发',
  '省部基金',
  '横向课题',
  '校级基金',
  '其他',
];

// ============ 工具函数 ============
function getWeekStart(date: Date): Date {
  return startOfWeek(date, { weekStartsOn: 1 }); // 周一为一周开始
}

function getDaysOfWeek(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** 将日期+slot索引转换为Date */
function slotToDate(day: Date, slot: number): Date {
  const totalMinutes = slot * SLOT_MINUTES;
  const h = Math.floor(totalMinutes / 60) + START_HOUR;
  const m = totalMinutes % 60;
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

/** 获取某天内的预约块（仅返回该天内的预约） */
function getReservationsForDay(reservations: ReservationItem[], day: Date): ReservationItem[] {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = addDays(dayStart, 1);
  return reservations.filter((r) => {
    const start = new Date(r.startTime);
    const end = new Date(r.endTime);
    return start < end && end > dayStart && start < dayEnd;
  });
}

/** 将预约拆分为该天的slot区间 */
function getReservationSlotsOnDay(r: ReservationItem, day: Date): { start: number; end: number } | null {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = addDays(dayStart, 1);

  const rStart = new Date(r.startTime);
  const rEnd = new Date(r.endTime);

  const overlapStart = rStart < dayStart ? dayStart : rStart;
  const overlapEnd = rEnd > dayEnd ? dayEnd : rEnd;
  if (overlapStart >= overlapEnd) return null;

  const startMinutes = overlapStart.getHours() * 60 + overlapStart.getMinutes() - START_HOUR * 60;
  const endMinutes = overlapEnd.getHours() * 60 + overlapEnd.getMinutes() - START_HOUR * 60;

  const startSlot = Math.max(0, Math.floor(startMinutes / SLOT_MINUTES));
  const endSlot = Math.min(SLOTS_PER_DAY, Math.ceil(endMinutes / SLOT_MINUTES));

  if (startSlot >= endSlot) return null;
  return { start: startSlot, end: endSlot };
}

// ============ 颜色配置 ============
const statusColors: Record<ReservationItem['status'], string> = {
  PENDING: 'bg-gradient-to-r from-amber-400 to-orange-500',
  APPROVED: 'bg-gradient-to-r from-blue-400 to-blue-500',
  ACTIVE: 'bg-gradient-to-r from-emerald-400 to-green-500',
  COMPLETED: 'bg-gradient-to-r from-gray-400 to-gray-500',
  CANCELLED: 'bg-gradient-to-r from-gray-300 to-gray-400 opacity-50',
  REJECTED: 'bg-gradient-to-r from-red-300 to-rose-400 opacity-60',
};

const statusLabels: Record<ReservationItem['status'], string> = {
  PENDING: '待审批',
  APPROVED: '已通过',
  ACTIVE: '使用中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  REJECTED: '已拒绝',
};

// ============ 主组件 ============
export default function WeekScheduler({
  deviceId,
  deviceName,
  deviceRiskLevel,
  readOnly = false,
  refreshSignal = 0,
  onReservationChanged,
  demoMode = false,
}: WeekSchedulerProps) {
  const currentUser = useAuthStore((s) => s.user);
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const [reservations, setReservations] = useState<ReservationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 实验室工作时间（从 /api/labs/current 获取，用于非常规时间判定）
  const [workStartTime, setWorkStartTime] = useState('08:00'); // 默认 08:00
  const [workEndTime, setWorkEndTime] = useState('22:30'); // 默认 22:30

  // 拖拽状态
  const [isDragging, setIsDragging] = useState(false);
  const [dragDayIndex, setDragDayIndex] = useState<number | null>(null);
  const [dragStartSlot, setDragStartSlot] = useState<number | null>(null);
  const [dragCurrentSlot, setDragCurrentSlot] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const extendingRef = useRef(false); // 标记当前是"点击扩展"而非"拖拽"
  const resizeDragRef = useRef<{ type: 'start' | 'end'; dayIndex: number; origStart: number; origEnd: number } | null>(null);

  // 选中的预约时段（松开鼠标后保留，不自动弹窗）
  const [selectedRange, setSelectedRange] = useState<{ dayIndex: number; startSlot: number; endSlot: number } | null>(null);

  // 间断提示
  const [warning, setWarning] = useState<string | null>(null);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 确认弹窗
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmForm, setConfirmForm] = useState({
    purpose: '',
    fundInfo: '',
    startTimeIdx: 0,
    endTimeIdx: 1,
  });
  const [submitting, setSubmitting] = useState(false);

  // 非常规时间安全提示弹窗
  const [offHoursWarningOpen, setOffHoursWarningOpen] = useState(false);
  const [offHoursConfirmed, setOffHoursConfirmed] = useState(false);

  // 详情弹窗（点击已存在的预约）
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRes, setDetailRes] = useState<ReservationItem | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  const days = useMemo(() => getDaysOfWeek(weekStart), [weekStart]);

  // 切换周次（同时清除选段，避免跨周残留）
  const goToWeek = useCallback((next: Date) => {
    setWeekStart(next);
    setSelectedRange(null);
  }, []);

  // 加载预约数据
  const fetchReservations = useCallback(async () => {
    if (demoMode) {
      setReservations([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const weekStartISO = weekStart.toISOString();
      const weekEndISO = addDays(weekStart, 7).toISOString();
      const res = await authFetch(
        `/api/devices/${deviceId}/reservations?startDate=${encodeURIComponent(weekStartISO)}&endDate=${encodeURIComponent(weekEndISO)}`
      );
      if (!res.ok) throw new Error('加载预约失败');
      const data = await res.json();
      setReservations((data.data ?? []) as ReservationItem[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载预约失败');
    } finally {
      setLoading(false);
    }
  }, [demoMode, deviceId, weekStart]);

  useEffect(() => {
    // 数据获取 effect：fetchReservations 内部会调用 setState
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchReservations();
  }, [fetchReservations, refreshSignal]);

  // 获取实验室工作时间配置
  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch('/api/labs/current');
        if (res.ok) {
          const data = await res.json();
          if (data.workStartTime) setWorkStartTime(data.workStartTime);
          if (data.workEndTime) setWorkEndTime(data.workEndTime);
        }
      } catch {
        // 静默失败，使用默认值
      }
    })();
  }, []);

  // 最大可预约日期（今天 + 3 天）
  const maxBookDate = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + MAX_BOOK_DAYS_AHEAD);
    return d;
  }, []);

  /** 检查某个 slot 是否在非常规（下班）时间内 */
  const isOffHoursSlot = useCallback((dayIndex: number, slot: number): boolean => {
    const day = days[dayIndex];
    if (!day) return false;
    const slotTime = slotToDate(day, slot);
    const hh = slotTime.getHours();
    const mm = slotTime.getMinutes();
    const slotMinutes = hh * 60 + mm; // 0-1435
    const [wsh, wsm] = workStartTime.split(':').map(Number);
    const [weh, wem] = workEndTime.split(':').map(Number);
    const workStart = wsh * 60 + wsm;
    const workEnd = weh * 60 + wem;
    // 非常规时间 = workEndTime 之后 ~ 次日 workStartTime 之前
    return slotMinutes >= workEnd || slotMinutes < workStart;
  }, [days, workStartTime, workEndTime]);

  // 显示临时警告
  const showWarning = useCallback((msg: string) => {
    setWarning(msg);
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    warningTimerRef.current = setTimeout(() => setWarning(null), 3000);
  }, []);

  // 检查某slot是否被占用
  const isSlotOccupied = useCallback((dayIndex: number, slot: number): boolean => {
    const day = days[dayIndex];
    if (!day) return false;
    const dayReservations = getReservationsForDay(reservations, day);
    return dayReservations.some((r) => {
      const slots = getReservationSlotsOnDay(r, day);
      return slots && slot >= slots.start && slot < slots.end;
    });
  }, [days, reservations]);

  // 全局松开鼠标：仅完成拖拽选段，不自动弹窗
  useEffect(() => {
    const handleMouseUp = () => {
      // 处理选段缩放拖拽
      if (resizeDragRef.current) {
        resizeDragRef.current = null;
        return;
      }
      // 如果是"点击扩展"模式，直接清除标记，不做拖拽处理
      if (extendingRef.current) {
        extendingRef.current = false;
        return;
      }
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setIsDragging(false);

      if (dragDayIndex !== null && dragStartSlot !== null && dragCurrentSlot !== null) {
        const start = Math.min(dragStartSlot, dragCurrentSlot);
        const end = Math.max(dragStartSlot, dragCurrentSlot);
        if (end >= start) {
          const day = days[dragDayIndex];
          const endDt = slotToDate(day, end + 1);
          if (endDt <= new Date()) {
            showWarning('不能预约过去的时间段');
          } else {
            // 检查选中范围内是否有占用
            let hasConflict = false;
            for (let s = start; s <= end; s++) {
              if (isSlotOccupied(dragDayIndex, s)) { hasConflict = true; break; }
            }
            if (hasConflict) {
              showWarning('选段中包含已占用的时段，请重新选择');
            } else {
              setSelectedRange({ dayIndex: dragDayIndex, startSlot: start, endSlot: end });
            }
          }
        }
      }
      setDragDayIndex(null);
      setDragStartSlot(null);
      setDragCurrentSlot(null);
    };

    // 拖拽缩放选段：鼠标移动时根据 slot 调整起始/结束
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeDragRef.current) return;
      const info = resizeDragRef.current;
      // 根据鼠标 x 坐标计算 slot
      const target = e.target as HTMLElement;
      // 找到最近的 slot 容器
      const gridCell = target.closest('[data-slot-idx]') as HTMLElement | null;
      if (!gridCell) return;
      const slotIdx = Number(gridCell.getAttribute('data-slot-idx'));
      if (Number.isNaN(slotIdx)) return;

      setSelectedRange((prev) => {
        if (!prev || prev.dayIndex !== info.dayIndex) return prev;
        if (info.type === 'start') {
          // 起始拖拽柄：不能超过结束-1
          const newStart = Math.max(0, Math.min(slotIdx, info.origEnd - 1));
          // 检查不能拖到过去时间
          const day = days[info.dayIndex];
          const newStartDt = slotToDate(day, newStart);
          if (newStartDt <= new Date()) return prev;
          // 检查不能与占用冲突
          for (let s = newStart; s < prev.startSlot; s++) {
            if (isSlotOccupied(info.dayIndex, s)) return prev;
          }
          return { ...prev, startSlot: newStart };
        } else {
          // 结束拖拽柄：不能小于起始+1，不能超过当日上限
          const newEnd = Math.min(SLOTS_PER_DAY - 1, Math.max(slotIdx, info.origStart + 1));
          for (let s = prev.endSlot + 1; s <= newEnd; s++) {
            if (isSlotOccupied(info.dayIndex, s)) return prev;
          }
          return { ...prev, endSlot: newEnd };
        }
      });
    };

    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [dragDayIndex, dragStartSlot, dragCurrentSlot, days, isSlotOccupied, showWarning]);

  // 鼠标按下：判断是"扩展选段"还是"开始新拖拽"
  const handleMouseDown = (dayIndex: number, slot: number, e: React.MouseEvent) => {
    if (readOnly) return;
    e.preventDefault();

    // 被占用的slot不可选
    if (isSlotOccupied(dayIndex, slot)) return;

    const day = days[dayIndex];
    if (!day) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (day < today) return; // 过去的日期不可选
    // 超过最大可预约日期不可选
    const dayMidnight = new Date(day);
    dayMidnight.setHours(0, 0, 0, 0);
    if (dayMidnight > maxBookDate) return;

    // 有选中选段时，判断是否点击在相邻位置以扩展
    if (selectedRange && selectedRange.dayIndex === dayIndex) {
      // 点击在选段起始的前一个slot → 向前扩展
      if (slot === selectedRange.startSlot - 1) {
        const newStartDt = slotToDate(day, slot);
        if (newStartDt <= new Date()) {
          showWarning('不能预约过去的时间段');
          extendingRef.current = true;
          return;
        }
        setSelectedRange({ ...selectedRange, startSlot: slot });
        extendingRef.current = true;
        return;
      }
      // 点击在选段结束的后一个slot → 向后扩展
      if (slot === selectedRange.endSlot + 1) {
        if (slot >= SLOTS_PER_DAY) {
          showWarning('已到达当日最晚时段');
          extendingRef.current = true;
          return;
        }
        setSelectedRange({ ...selectedRange, endSlot: slot });
        extendingRef.current = true;
        return;
      }
      // 点击在选段内部 → 删除整个选段
      if (slot >= selectedRange.startSlot && slot <= selectedRange.endSlot) {
        extendingRef.current = true;
        setSelectedRange(null);
        return;
      }
      // 点击在非相邻位置 → 提示间断
      showWarning('预约时间必须连续，如需间断请先确认当前选段后再预约新时段');
      extendingRef.current = true;
      return;
    }

    // 无选段或在其他天 → 开始新拖拽
    draggingRef.current = true;
    setIsDragging(true);
    setDragDayIndex(dayIndex);
    setDragStartSlot(slot);
    setDragCurrentSlot(slot);
  };

  const handleMouseEnter = (dayIndex: number, slot: number) => {
    if (draggingRef.current && dragDayIndex === dayIndex) {
      // 拖拽时不经过占用slot
      if (isSlotOccupied(dayIndex, slot)) return;
      setDragCurrentSlot(slot);
    }
  };

  // 打开确认弹窗
  const handleOpenConfirm = () => {
    if (!selectedRange) return;
    // 检查选段是否包含非常规时间
    let hasOffHours = false;
    for (let s = selectedRange.startSlot; s <= selectedRange.endSlot; s++) {
      if (isOffHoursSlot(selectedRange.dayIndex, s)) {
        hasOffHours = true;
        break;
      }
    }
    setOffHoursConfirmed(false);
    if (hasOffHours && !offHoursConfirmed) {
      // 首次选中非常规时间 → 弹出安全提示
      setOffHoursWarningOpen(true);
      return;
    }
    setConfirmForm({
      purpose: '',
      fundInfo: '',
      startTimeIdx: selectedRange.startSlot,
      endTimeIdx: selectedRange.endSlot + 1,
    });
    setConfirmOpen(true);
  };

  // 非常规时间安全提示确认后，继续打开预约确认弹窗
  const handleOffHoursConfirm = () => {
    setOffHoursWarningOpen(false);
    setOffHoursConfirmed(true);
    if (!selectedRange) return;
    setConfirmForm({
      purpose: '',
      fundInfo: '',
      startTimeIdx: selectedRange.startSlot,
      endTimeIdx: selectedRange.endSlot + 1,
    });
    setConfirmOpen(true);
  };

  // 确认弹窗内：检查时间冲突
  const dialogTimeConflict = useMemo(() => {
    if (!selectedRange) return false;
    for (let s = confirmForm.startTimeIdx; s < confirmForm.endTimeIdx; s++) {
      if (isSlotOccupied(selectedRange.dayIndex, s)) return true;
    }
    return false;
  }, [selectedRange, confirmForm.startTimeIdx, confirmForm.endTimeIdx, isSlotOccupied]);

  // 确认弹窗内：检查时间是否在过去
  const dialogTimePast = useMemo(() => {
    if (!selectedRange) return false;
    const day = days[selectedRange.dayIndex];
    const endDt = slotToDate(day, confirmForm.endTimeIdx);
    return endDt <= new Date();
  }, [selectedRange, confirmForm.endTimeIdx, days]);

  // 提交预约
  const handleSubmitReservation = async () => {
    if (!selectedRange) return;
    if (!confirmForm.purpose.trim()) return;
    if (confirmForm.endTimeIdx <= confirmForm.startTimeIdx) {
      showWarning('结束时间必须晚于开始时间');
      return;
    }

    const day = days[selectedRange.dayIndex];
    const startDt = slotToDate(day, confirmForm.startTimeIdx);
    const endDt = slotToDate(day, confirmForm.endTimeIdx);

    setSubmitting(true);
    try {
      if (demoMode) {
        setReservations((current) => [
          ...current,
          {
            id: `demo-reservation-${Date.now()}`,
            userId: currentUser?.id ?? 'demo-user',
            userName: currentUser?.name ?? '演示用户',
            startTime: startDt.toISOString(),
            endTime: endDt.toISOString(),
            purpose: confirmForm.purpose.trim(),
            fundInfo: confirmForm.fundInfo || null,
            status: 'PENDING',
          },
        ]);
        setConfirmOpen(false);
        setSelectedRange(null);
        setConfirmForm({ purpose: '', fundInfo: '', startTimeIdx: 0, endTimeIdx: 1 });
        return;
      }
      const res = await authFetch(`/api/devices/${deviceId}/reservations`, {
        method: 'POST',
        body: JSON.stringify({
          startTime: startDt.toISOString(),
          endTime: endDt.toISOString(),
          purpose: confirmForm.purpose.trim(),
          fundInfo: confirmForm.fundInfo || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || '预约失败');
      }
      setConfirmOpen(false);
      setSelectedRange(null);
      setConfirmForm({ purpose: '', fundInfo: '', startTimeIdx: 0, endTimeIdx: 1 });
      fetchReservations();
      onReservationChanged?.();
    } catch (err) {
      showWarning(err instanceof Error ? err.message : '预约失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 取消预约
  const handleCancelReservation = async (resId: string) => {
    if (demoMode) {
      setReservations((current) => current.filter((reservation) => reservation.id !== resId));
      setDetailOpen(false);
      setDetailRes(null);
      return;
    }
    setCancelingId(resId);
    try {
      const res = await authFetch(`/api/reservations/${resId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'CANCEL' }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || '取消失败');
      }
      setDetailOpen(false);
      setDetailRes(null);
      fetchReservations();
      onReservationChanged?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : '取消失败');
    } finally {
      setCancelingId(null);
    }
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 选段的时间标签
  const selectedRangeLabel = selectedRange
    ? `${format(days[selectedRange.dayIndex], 'MM-dd EEE', { locale: zhCN })} ${timeOptions[selectedRange.startSlot]} - ${timeOptions[selectedRange.endSlot + 1]}`
    : '';

  return (
    <div className="space-y-4">
      {/* 工具栏：左侧周次+确定按钮，右侧图例 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => goToWeek(addDays(weekStart, -7))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-sm font-semibold min-w-[180px] text-center">
            {format(weekStart, 'yyyy-MM-dd', { locale: zhCN })} ~ {format(addDays(weekStart, 6), 'yyyy-MM-dd', { locale: zhCN })}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => goToWeek(addDays(weekStart, 7))}
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => goToWeek(getWeekStart(new Date()))}
          >
            本周
          </Button>

          {/* 分隔线 + 确定预约按钮 */}
          {!readOnly && (
            <>
              <div className="mx-1 h-6 w-px bg-gray-200" />
              <Button
                size="sm"
                disabled={!selectedRange}
                onClick={handleOpenConfirm}
                className={cn(
                  'gap-1.5 font-semibold transition-all',
                  selectedRange
                    ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md hover:from-blue-700 hover:to-indigo-700'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                )}
              >
                <CheckCircle2 className="size-4" />
                确定预约
              </Button>
              {selectedRange && (
                <>
                  <span className="text-xs text-blue-600 font-medium">{selectedRangeLabel}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedRange(null)}
                    className="text-gray-400 hover:text-gray-600 h-7 px-2"
                  >
                    <X className="size-3.5" />清除
                  </Button>
                </>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-4 text-xs text-gray-600">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-gradient-to-r from-blue-400 to-blue-500 rounded"></div>
            <span>我的预约</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-gradient-to-r from-rose-400 to-pink-500 rounded"></div>
            <span>他人占用</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-gradient-to-r from-amber-400 to-orange-500 rounded"></div>
            <span>待审批</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-white border border-gray-300 rounded"></div>
            <span>{readOnly ? '空闲' : '可拖拽预约'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-amber-50 border border-amber-200 rounded"></div>
            <span>非常规时间</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-gray-100 border border-gray-300 rounded"></div>
            <span>未开放</span>
          </div>
        </div>
      </div>

      {/* 间断提示条 */}
      {warning && (
        <div className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700 animate-in fade-in">
          <AlertTriangle className="size-4 shrink-0" />
          <span>{warning}</span>
        </div>
      )}

      {/* 操作提示 */}
      {!readOnly && !warning && (
        <div className="rounded-md bg-blue-50 border border-blue-100 px-3 py-1.5 text-xs text-blue-600">
          提示：拖拽鼠标框选预约时段，松开后可点击相邻时段微调选段。
          点击已选中的块可删除整个选段；选段两端蓝色拖拽柄可调整起止时间。
          选好后点击「确定预约」。预约需连续，间断请分多次预约。
          最多可预约 <span className="font-bold">3 天后</span> 的设备（如今天 {format(new Date(), 'MM-dd')}，最远可预约 {format(addDays(new Date(), 3), 'MM-dd')}）。
          琥珀色底色为非常规（下班）时间，预约时将弹出安全提示。
        </div>
      )}

      {/* 风险等级提示 */}
      {(deviceRiskLevel === 'HIGH' || deviceRiskLevel === 'CRITICAL') && !readOnly && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
          提示：该设备为{deviceRiskLevel === 'HIGH' ? '高' : '极高'}风险设备，预约需管理员审批后生效。
        </div>
      )}

      {/* 日历网格 */}
      <div className="overflow-auto border border-gray-200 rounded-lg select-none bg-white">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-gray-400" />
            <span className="ml-2 text-sm text-gray-500">加载预约数据...</span>
          </div>
        ) : error ? (
          <div className="py-12 text-center text-sm text-red-500">{error}</div>
        ) : (
          <div className="inline-grid min-w-max border border-gray-200" style={{ gridTemplateColumns: `${LABEL_WIDTH}px repeat(${SLOTS_PER_DAY}, ${SLOT_WIDTH}px)` }}>
            {/* 表头：左上角 + 时间轴 */}
            <div className="bg-slate-50 flex items-center justify-center text-xs font-bold text-gray-500 sticky left-0 top-0 z-30 border-r border-gray-200">
              日期\时间
            </div>
            {/* 时间轴：单个跨列容器，内部绝对定位网格线与小时标签，避免相邻单元格背景遮挡文字 */}
            <div
              className="relative bg-slate-50 sticky top-0 z-20 border-b border-gray-200"
              style={{ height: '32px', gridColumnStart: 2, gridColumnEnd: SLOTS_PER_DAY + 2 }}
            >
              {/* 网格线 */}
              {Array.from({ length: SLOTS_PER_DAY }).map((_, slotIdx) => (
                <div
                  key={slotIdx}
                  className={`absolute top-0 bottom-0 ${slotIdx % 2 === 0 ? 'border-l border-gray-300' : 'border-l border-gray-100'}`}
                  style={{ left: slotIdx * SLOT_WIDTH, width: SLOT_WIDTH }}
                />
              ))}
              {/* 小时标签 */}
              {Array.from({ length: END_HOUR - START_HOUR }).map((_, hourIdx) => {
                const hour = START_HOUR + hourIdx;
                return (
                  <span
                    key={hour}
                    className="absolute bottom-1 whitespace-nowrap text-center text-xs font-bold leading-none text-gray-700"
                    style={{ left: hourIdx * 2 * SLOT_WIDTH, width: SLOT_WIDTH * 2 }}
                  >
                    {hour.toString().padStart(2, '0')}:00
                  </span>
                );
              })}
            </div>

            {/* 每天7行 */}
            {days.map((day, dayIndex) => {
              const dayReservations = getReservationsForDay(reservations, day);
              // 构建每个slot的状态
              const slotMap: Array<{ type: 'empty'; res?: undefined } | { type: 'occupied'; res: ReservationItem; isMine: boolean; startSlot: number; endSlot: number }> = [];
              for (let s = 0; s < SLOTS_PER_DAY; s++) {
                const occupied = dayReservations.find((r) => {
                  const slots = getReservationSlotsOnDay(r, day);
                  return slots && s >= slots.start && s < slots.end;
                });
                if (occupied) {
                  const slots = getReservationSlotsOnDay(occupied, day)!;
                  const isMine = occupied.userId === currentUser?.id;
                  slotMap[s] = { type: 'occupied', res: occupied, isMine, startSlot: slots.start, endSlot: slots.end };
                } else {
                  slotMap[s] = { type: 'empty' };
                }
              }

              // 合并连续occupied块
              const blocks: Array<{ start: number; end: number; res: ReservationItem; isMine: boolean }> = [];
              let i = 0;
              while (i < SLOTS_PER_DAY) {
                const cur = slotMap[i];
                if (cur && cur.type === 'occupied') {
                  const start = i;
                  while (i < SLOTS_PER_DAY && slotMap[i] && slotMap[i].type === 'occupied' && slotMap[i].res!.id === cur.res.id) i++;
                  blocks.push({ start, end: i - 1, res: cur.res, isMine: cur.isMine });
                } else {
                  i++;
                }
              }

              const isToday = isSameDay(day, new Date());
              const isPast = day < today;
              // 超过最大可预约日期 → 锁定
              const dayMidnight = new Date(day);
              dayMidnight.setHours(0, 0, 0, 0);
              const isLocked = dayMidnight > maxBookDate;

              return (
                <Fragment key={dayIndex}>
                  {/* 日期标签 */}
                  <div className={`p-2 text-center text-xs font-bold sticky left-0 z-10 border-r border-gray-200 flex flex-col items-center justify-center ${
                    isLocked
                      ? 'bg-gray-100 text-gray-400'
                      : isToday
                        ? 'bg-blue-50 text-blue-700'
                        : 'bg-white text-gray-800'
                  }`}>
                    <span>{format(day, 'EEE', { locale: zhCN })}</span>
                    <span className="text-sm">{format(day, 'MM-dd')}</span>
                    {isToday && !isLocked && <span className="text-[10px] text-blue-500 mt-0.5">今日</span>}
                    {isLocked && <span className="text-[10px] text-gray-400 mt-0.5">未开放</span>}
                  </div>
                  {/* slot网格 */}
                  <div className="relative" style={{ width: SLOTS_PER_DAY * SLOT_WIDTH, height: ROW_HEIGHT, gridColumnStart: 2, gridColumnEnd: SLOTS_PER_DAY + 2 }}>
                    {/* 空格背景：拖拽区 */}
                    {Array.from({ length: SLOTS_PER_DAY }).map((_, slotIdx) => {
                      const isHourStart = slotIdx % 2 === 0;
                      const isDraggingHere = isDragging && dragDayIndex === dayIndex && dragStartSlot !== null && dragCurrentSlot !== null && slotIdx >= Math.min(dragStartSlot, dragCurrentSlot) && slotIdx <= Math.max(dragStartSlot, dragCurrentSlot);
                      const isSelectedHere = !isDragging && selectedRange && selectedRange.dayIndex === dayIndex && slotIdx >= selectedRange.startSlot && slotIdx <= selectedRange.endSlot;
                      const isOccupiedHere = slotMap[slotIdx].type === 'occupied';
                      const isOffHours = isOffHoursSlot(dayIndex, slotIdx);
                      const slotLocked = isLocked || isPast;
                      return (
                        <div
                          key={slotIdx}
                          data-slot-idx={slotIdx}
                          data-day-idx={dayIndex}
                          onMouseDown={(e) => handleMouseDown(dayIndex, slotIdx, e)}
                          onMouseEnter={() => handleMouseEnter(dayIndex, slotIdx)}
                          title={slotLocked && isLocked ? '该日期未开放预约' : isOffHours && !isOccupiedHere ? '非常规（下班）时间，请注意实验安全' : undefined}
                          className={cn(
                            'absolute transition-colors border-b border-gray-100',
                            isHourStart ? 'border-l border-l-gray-300' : 'border-l border-l-gray-100',
                            isDraggingHere
                              ? 'bg-blue-300 border-blue-500 shadow-inner'
                              : isSelectedHere
                                ? 'bg-blue-200 border-blue-400 shadow-inner'
                                : isOccupiedHere
                                  ? 'bg-transparent'
                                  : slotLocked
                                    ? isLocked
                                      ? 'bg-gray-100 cursor-not-allowed opacity-60'
                                      : 'bg-gray-50 cursor-not-allowed opacity-50'
                                    : isOffHours
                                      ? 'bg-amber-50/40 hover:bg-amber-100 cursor-pointer'
                                      : 'bg-white hover:bg-blue-50 cursor-pointer'
                          )}
                          style={{ left: slotIdx * SLOT_WIDTH, top: 0, width: SLOT_WIDTH, height: ROW_HEIGHT }}
                        />
                      );
                    })}
                    {/* 选段边框高亮 */}
                    {selectedRange && selectedRange.dayIndex === dayIndex && !isDragging && (
                      <>
                        <div
                          className="absolute border-2 border-blue-500 rounded-md pointer-events-none z-[5]"
                          style={{
                            left: selectedRange.startSlot * SLOT_WIDTH,
                            top: 2,
                            width: (selectedRange.endSlot - selectedRange.startSlot + 1) * SLOT_WIDTH,
                            height: ROW_HEIGHT - 4,
                          }}
                        />
                        {/* 选段两端拖拽柄：可拖拽缩短选段 */}
                        {selectedRange.endSlot > selectedRange.startSlot && (
                          <>
                            <div
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                resizeDragRef.current = {
                                  type: 'start',
                                  dayIndex,
                                  origStart: selectedRange.startSlot,
                                  origEnd: selectedRange.endSlot,
                                };
                              }}
                              title="拖拽调整起始时间"
                              className="absolute z-[6] flex cursor-ew-resize items-center justify-center rounded-l-md bg-blue-600/80 hover:bg-blue-700 transition-colors"
                              style={{
                                left: selectedRange.startSlot * SLOT_WIDTH,
                                top: 2,
                                width: 6,
                                height: ROW_HEIGHT - 4,
                              }}
                            />
                            <div
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                resizeDragRef.current = {
                                  type: 'end',
                                  dayIndex,
                                  origStart: selectedRange.startSlot,
                                  origEnd: selectedRange.endSlot,
                                };
                              }}
                              title="拖拽调整结束时间"
                              className="absolute z-[6] flex cursor-ew-resize items-center justify-center rounded-r-md bg-blue-600/80 hover:bg-blue-700 transition-colors"
                              style={{
                                left: (selectedRange.endSlot + 1) * SLOT_WIDTH - 6,
                                top: 2,
                                width: 6,
                                height: ROW_HEIGHT - 4,
                              }}
                            />
                          </>
                        )}
                      </>
                    )}
                    {/* 预约块叠加层 */}
                    {blocks.map((b) => {
                      const width = (b.end - b.start + 1) * SLOT_WIDTH;
                      const left = b.start * SLOT_WIDTH;
                      const color = statusColors[b.res.status];
                      const canClick = b.isMine && (b.res.status === 'PENDING' || b.res.status === 'APPROVED' || b.res.status === 'ACTIVE');
                      return (
                        <div
                          key={b.res.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (canClick || b.isMine) {
                              setDetailRes(b.res);
                              setDetailOpen(true);
                            }
                          }}
                          title={`${b.res.userName} - ${b.res.purpose || ''}\n状态：${statusLabels[b.res.status]}\n${format(new Date(b.res.startTime), 'HH:mm')} - ${format(new Date(b.res.endTime), 'HH:mm')}`}
                          className={`absolute rounded-md shadow-sm text-white text-[10px] font-semibold flex items-center justify-center px-1 border border-white/30 overflow-hidden z-10 ${color} ${
                            b.isMine ? 'cursor-pointer hover:ring-2 hover:ring-blue-400 hover:opacity-90' : 'cursor-default'
                          }`}
                          style={{ left: left + 2, top: 4, width: width - 4, height: ROW_HEIGHT - 8 }}
                        >
                          <span className="truncate drop-shadow-sm">{b.isMine ? '我' : b.res.userName}</span>
                        </div>
                      );
                    })}
                  </div>
                </Fragment>
              );
            })}
          </div>
        )}
      </div>

      {/* 确认预约弹窗 */}
      <Dialog
        open={confirmOpen}
        onOpenChange={(v) => {
          setConfirmOpen(v);
          if (!v) setConfirmForm((p) => ({ ...p, purpose: '' }));
        }}
        title="确认预约信息"
        description={`预约设备「${deviceName}」`}
        footer={
          <>
            <Button variant="outline" onClick={() => { setConfirmOpen(false); }} disabled={submitting}>取消</Button>
            <Button
              onClick={handleSubmitReservation}
              disabled={submitting || !confirmForm.purpose.trim() || dialogTimeConflict || dialogTimePast || confirmForm.endTimeIdx <= confirmForm.startTimeIdx}
            >
              {submitting ? '提交中...' : '确认预约'}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 py-2">
          {/* 日期 */}
          <div className="rounded-md bg-gray-50 border border-gray-100 px-3 py-2">
            <div className="text-xs text-gray-500">预约日期</div>
            <div className="text-sm font-semibold text-gray-800">
              {selectedRange && format(days[selectedRange.dayIndex], 'yyyy-MM-dd EEEE', { locale: zhCN })}
            </div>
          </div>

          {/* 开始时间 + 结束时间下拉 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs text-gray-600">开始时间</Label>
              <select
                className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={confirmForm.startTimeIdx}
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  setConfirmForm((prev) => {
                    // 如果结束时间不大于开始时间，自动调整
                    if (prev.endTimeIdx <= idx) {
                      return { ...prev, startTimeIdx: idx, endTimeIdx: idx + 1 };
                    }
                    return { ...prev, startTimeIdx: idx };
                  });
                }}
              >
                {timeOptions.slice(0, SLOTS_PER_DAY).map((t, idx) => (
                  <option key={t} value={idx}>{t}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs text-gray-600">结束时间</Label>
              <select
                className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={confirmForm.endTimeIdx}
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  setConfirmForm((p) => ({ ...p, endTimeIdx: idx }));
                }}
              >
                {timeOptions.slice(1, SLOTS_PER_DAY + 1).map((t, idx) => (
                  <option key={t} value={idx + 1}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 时间冲突/过去提示 */}
          {dialogTimePast && (
            <div className="flex items-center gap-2 text-xs text-red-600">
              <AlertTriangle className="size-4" />
              所选时段已过去，请重新选择
            </div>
          )}
          {dialogTimeConflict && (
            <div className="flex items-center gap-2 text-xs text-red-600">
              <AlertTriangle className="size-4" />
              所选时段与已有预约冲突，请调整时间
            </div>
          )}
          {confirmForm.endTimeIdx <= confirmForm.startTimeIdx && (
            <div className="flex items-center gap-2 text-xs text-red-600">
              <AlertTriangle className="size-4" />
              结束时间必须晚于开始时间
            </div>
          )}

          {/* 关联基金/课题 */}
          <div className="grid gap-1.5">
            <Label className="text-xs text-gray-600">关联基金/课题</Label>
            <select
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={confirmForm.fundInfo}
              onChange={(e) => setConfirmForm((p) => ({ ...p, fundInfo: e.target.value }))}
            >
              <option value="">请选择（可选）</option>
              {FUND_OPTIONS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>

          {/* 用途说明 */}
          <div className="grid gap-1.5">
            <Label className="text-xs text-gray-600">用途说明 *</Label>
            <Textarea
              placeholder="请说明使用用途"
              value={confirmForm.purpose}
              onChange={(e) => setConfirmForm((p) => ({ ...p, purpose: e.target.value }))}
              rows={3}
            />
          </div>
        </div>
      </Dialog>

      {/* 预约详情弹窗 */}
      <Dialog
        open={detailOpen}
        onOpenChange={(v) => {
          setDetailOpen(v);
          if (!v) setDetailRes(null);
        }}
        title="预约详情"
        footer={
          <>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>关闭</Button>
            {detailRes && detailRes.userId === currentUser?.id && (detailRes.status === 'PENDING' || detailRes.status === 'APPROVED') && (
              <Button
                variant="destructive"
                onClick={() => handleCancelReservation(detailRes.id)}
                disabled={cancelingId === detailRes.id}
              >
                {cancelingId === detailRes.id ? '取消中...' : '取消预约'}
              </Button>
            )}
          </>
        }
      >
        {detailRes && (
          <div className="space-y-3 py-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">预约人</span><span className="font-semibold">{detailRes.userName}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">状态</span><span className="font-semibold">{statusLabels[detailRes.status]}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">开始时间</span><span>{format(new Date(detailRes.startTime), 'yyyy-MM-dd HH:mm')}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">结束时间</span><span>{format(new Date(detailRes.endTime), 'yyyy-MM-dd HH:mm')}</span></div>
            {detailRes.fundInfo && <div className="flex justify-between"><span className="text-gray-500">基金/课题</span><span className="font-semibold">{detailRes.fundInfo}</span></div>}
            {detailRes.purpose && <div className="rounded-md bg-gray-50 p-3"><div className="text-gray-500 mb-1">用途</div><div>{detailRes.purpose}</div></div>}
            {detailRes.note && <div className="rounded-md bg-gray-50 p-3"><div className="text-gray-500 mb-1">备注</div><div>{detailRes.note}</div></div>}
          </div>
        )}
      </Dialog>

      {/* 非常规时间安全提示弹窗 */}
      <Dialog
        open={offHoursWarningOpen}
        onOpenChange={(v) => {
          setOffHoursWarningOpen(v);
          if (!v) setOffHoursConfirmed(false);
        }}
        title={
          <span className="flex items-center gap-2 text-amber-700">
            <AlertTriangle className="size-5" />
            非常规时间预约安全提示
          </span>
        }
        footer={
          <>
            <Button variant="outline" onClick={() => { setOffHoursWarningOpen(false); setOffHoursConfirmed(false); }}>
              取消预约
            </Button>
            <Button
              onClick={handleOffHoursConfirm}
              className="bg-amber-600 text-white hover:bg-amber-700"
            >
              <CheckCircle2 className="size-4" />
              已知悉，继续预约
            </Button>
          </>
        }
      >
        <div className="space-y-3 py-2">
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
            <div className="font-semibold mb-1">您当前预约的时段处于非常规（下班）时间：</div>
            <div className="text-xs text-amber-700">
              实验室常规工作时间：<span className="font-mono font-semibold">{workStartTime} - {workEndTime}</span>
            </div>
            {selectedRange && (
              <div className="text-xs text-amber-700 mt-1">
                您的预约时段：<span className="font-mono font-semibold">{timeOptions[selectedRange.startSlot]} - {timeOptions[selectedRange.endSlot + 1]}</span>
              </div>
            )}
          </div>
          <ul className="text-sm text-gray-700 space-y-1.5 pl-1">
            <li className="flex gap-2">
              <span className="text-amber-600 font-bold">·</span>
              <span>非常规时间使用实验室设备存在一定安全风险，请确保自身具备应急处置能力。</span>
            </li>
            <li className="flex gap-2">
              <span className="text-amber-600 font-bold">·</span>
              <span>使用前请检查设备状态、通风、水电等环境条件，确认无异常后方可开始实验。</span>
            </li>
            <li className="flex gap-2">
              <span className="text-amber-600 font-bold">·</span>
              <span>实验期间请保持通讯畅通，告知同组人员或值班人员您的实验安排。</span>
            </li>
            <li className="flex gap-2">
              <span className="text-amber-600 font-bold">·</span>
              <span>如遇紧急情况，请立即停止实验，拨打实验室安全员电话或报警。</span>
            </li>
            <li className="flex gap-2">
              <span className="text-amber-600 font-bold">·</span>
              <span>实验结束后请仔细检查并关闭设备、水电气源，确认现场安全后方可离开。</span>
            </li>
          </ul>
          <div className="rounded-md bg-red-50 border border-red-200 p-2 text-xs text-red-700">
            请确认您已仔细阅读上述安全注意事项，并承诺严格遵守实验室安全规范。
          </div>
        </div>
      </Dialog>
    </div>
  );
}
