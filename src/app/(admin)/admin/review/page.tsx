"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ShieldAlert,
  ShieldX,
  CheckCircle2,
  XCircle,
  Loader2,
  Cpu,
  FlaskConical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs } from "@/arco-adapters/tabs";
import { Dialog } from '@/arco-adapters/dialog';
import { Textarea } from '@/components/ui/textarea';
import type { Requisition, RequisitionStatus } from "@/types";
import { authFetch } from "@/lib/auth-fetch";

const STATUS_CONFIG: Record<RequisitionStatus, { label: string; className: string; icon: React.ElementType }> = {
  PENDING: { label: "待审核", className: "border-orange-500 text-orange-600 bg-orange-50", icon: ShieldAlert },
  APPROVED: { label: "已通过", className: "border-green-500 text-green-600 bg-green-50", icon: CheckCircle2 },
  NEEDS_CONFIRM: { label: "待审核", className: "border-orange-500 text-orange-600 bg-orange-50", icon: ShieldAlert },
  BLOCKED: { label: "已阻断", className: "border-red-500 text-red-600 bg-red-50", icon: ShieldX },
  REJECTED: { label: "已拒绝", className: "border-purple-500 text-purple-600 bg-purple-50", icon: XCircle },
};

// 设备预约状态配置
const RESERVATION_STATUS_CONFIG: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  PENDING: { label: "待审核", className: "border-orange-500 text-orange-600 bg-orange-50", icon: ShieldAlert },
  APPROVED: { label: "已通过", className: "border-green-500 text-green-600 bg-green-50", icon: CheckCircle2 },
  REJECTED: { label: "已拒绝", className: "border-purple-500 text-purple-600 bg-purple-50", icon: XCircle },
  ACTIVE: { label: "使用中", className: "border-blue-500 text-blue-600 bg-blue-50", icon: CheckCircle2 },
  COMPLETED: { label: "已完成", className: "border-gray-500 text-gray-600 bg-gray-50", icon: CheckCircle2 },
  CANCELLED: { label: "已取消", className: "border-gray-400 text-gray-500 bg-gray-50", icon: XCircle },
};

// 设备风险等级配置
const RISK_CONFIG: Record<string, { label: string; className: string }> = {
  HIGH: { label: "高危", className: "border-red-500 text-red-600 bg-red-50" },
  CRITICAL: { label: "极高危", className: "border-red-700 text-red-700 bg-red-100" },
  MEDIUM: { label: "中风险", className: "border-orange-500 text-orange-600 bg-orange-50" },
  LOW: { label: "低风险", className: "border-green-500 text-green-600 bg-green-50" },
};

interface RequisitionWithDetails extends Requisition {
  reagentName?: string;
  applicantName?: string;
  reviewerName?: string;
}

interface ReservationWithDetails {
  id: string;
  deviceId: string;
  userId: string;
  startTime: string;
  endTime: string;
  status: string;
  purpose?: string;
  note?: string | null;
  createdAt: string;
  device: { id: string; name: string; model: string; location: string; riskLevel: string };
  user: { id: string; name: string };
  reviewer?: { id: string; name: string } | null;
  reviewedAt?: string | null;
}

/** 将试剂领用原始数据映射为前端对象（纯函数，移至组件外避免闭包过期） */
function mapRequisition(r: Record<string, unknown>): RequisitionWithDetails {
  return {
    id: r.id as string,
    reagentId: r.reagentId as string,
    reagentName: (r.reagent as Record<string, unknown>)?.name as string ?? "未知试剂",
    applicantId: r.applicantId as string,
    applicantName: (r.applicant as Record<string, unknown>)?.name as string ?? "未知用户",
    quantity: r.quantity as number,
    purpose: (r.purpose as string) ?? "",
    status: r.status as RequisitionStatus,
    reviewResult: r.reviewResult as string | null,
    reviewedById: (r.reviewedById as string) ?? null,
    reviewedAt: (r.reviewedAt as string) ?? null,
    createdAt: r.createdAt as string,
  };
}

export default function AdminReviewPage() {
  const [activeTab, setActiveTab] = useState("pending");
  const [allRequisitions, setAllRequisitions] = useState<RequisitionWithDetails[]>([]);
  const [pendingRequisitions, setPendingRequisitions] = useState<RequisitionWithDetails[]>([]);
  const [pendingReservations, setPendingReservations] = useState<ReservationWithDetails[]>([]);
  const [allReservations, setAllReservations] = useState<ReservationWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectType, setRejectType] = useState<'requisition' | 'reservation'>('requisition');
  const [rejectReason, setRejectReason] = useState('');

  const fetchRequisitions = useCallback(async () => {
    setLoading(true);
    setReviewError(null);
    try {
      // 试剂领用：全部 + 待审核（PENDING + NEEDS_CONFIRM）
      const [allRes, pendingRes, needsConfirmRes, reservationsRes] = await Promise.all([
        authFetch("/api/requisitions?pageSize=50"),
        authFetch("/api/requisitions?status=PENDING&pageSize=50"),
        authFetch("/api/requisitions?status=NEEDS_CONFIRM&pageSize=50"),
        // 设备预约：全部（包含各状态，前端按 status 分组）
        authFetch("/api/reservations?pageSize=100"),
      ]);

      if (allRes.ok) {
        const allData = await allRes.json();
        setAllRequisitions(allData.data.map((r: Record<string, unknown>) => mapRequisition(r)));
      }
      // 合并 PENDING 和 NEEDS_CONFIRM 作为待审核试剂领用
      const pendingList: RequisitionWithDetails[] = [];
      if (pendingRes.ok) {
        const pendingData = await pendingRes.json();
        pendingList.push(...pendingData.data.map((r: Record<string, unknown>) => mapRequisition(r)));
      }
      if (needsConfirmRes.ok) {
        const needsConfirmData = await needsConfirmRes.json();
        pendingList.push(...needsConfirmData.data.map((r: Record<string, unknown>) => mapRequisition(r)));
      }
      pendingList.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setPendingRequisitions(pendingList);

      // 设备预约
      if (reservationsRes.ok) {
        const reservationsData = await reservationsRes.json();
        const reservations: ReservationWithDetails[] = reservationsData.data || [];
        setAllReservations(reservations);
        setPendingReservations(reservations.filter((r) => r.status === 'PENDING'));
      } else {
        setAllReservations([]);
        setPendingReservations([]);
      }
    } catch (error) {
      console.error("加载审批数据失败:", error);
      setReviewError("加载审批数据失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRequisitions(); }, [fetchRequisitions]);

  // ── 试剂领用审批 ──
  const handleApproveRequisition = useCallback(async (id: string) => {
    setReviewError(null);
    setReviewingId(id);
    try {
      const res = await authFetch(`/api/requisitions/${id}/review`, {
        method: "PUT",
        body: JSON.stringify({ action: "APPROVED", note: "管理员审核通过" }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(typeof err.details === "string" ? err.details : err.error || "审核失败");
      }
      fetchRequisitions();
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "审核失败");
    } finally {
      setReviewingId(null);
    }
  }, [fetchRequisitions]);

  const handleRejectRequisitionClick = useCallback((id: string) => {
    setRejectingId(id);
    setRejectType('requisition');
    setRejectReason('');
    setRejectDialogOpen(true);
  }, []);

  // ── 设备预约审批 ──
  const handleApproveReservation = useCallback(async (id: string) => {
    setReviewError(null);
    setReviewingId(id);
    try {
      const res = await authFetch(`/api/reservations/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "APPROVE", note: "管理员审批通过" }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "审批失败");
      }
      fetchRequisitions();
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "审批失败");
    } finally {
      setReviewingId(null);
    }
  }, [fetchRequisitions]);

  const handleRejectReservationClick = useCallback((id: string) => {
    setRejectingId(id);
    setRejectType('reservation');
    setRejectReason('');
    setRejectDialogOpen(true);
  }, []);

  // ── 统一拒绝确认 ──
  const handleRejectConfirm = useCallback(async () => {
    if (!rejectingId) return;
    setReviewError(null);
    setReviewingId(rejectingId);
    setRejectDialogOpen(false);
    try {
      const url = rejectType === 'requisition'
        ? `/api/requisitions/${rejectingId}/review`
        : `/api/reservations/${rejectingId}`;
      const body = rejectType === 'requisition'
        ? { action: "REJECTED", note: rejectReason || "管理员拒绝" }
        : { action: "REJECT", note: rejectReason || "管理员拒绝" };
      const res = await authFetch(url, {
        method: rejectType === 'requisition' ? "PUT" : "PATCH",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(typeof err.details === "string" ? err.details : err.error || "审核失败");
      }
      fetchRequisitions();
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "审核失败");
    } finally {
      setReviewingId(null);
      setRejectingId(null);
    }
  }, [rejectingId, rejectType, rejectReason, fetchRequisitions]);

  const renderStatusBadge = (status: RequisitionStatus) => {
    const config = STATUS_CONFIG[status];
    const Icon = config.icon;
    return (
      <Badge variant="outline" className={config.className}>
        <Icon className="size-3" />
        {config.label}
      </Badge>
    );
  };

  const renderReservationStatusBadge = (status: string) => {
    const config = RESERVATION_STATUS_CONFIG[status] || RESERVATION_STATUS_CONFIG.PENDING;
    const Icon = config.icon;
    return (
      <Badge variant="outline" className={config.className}>
        <Icon className="size-3" />
        {config.label}
      </Badge>
    );
  };

  const renderRiskBadge = (riskLevel: string) => {
    const config = RISK_CONFIG[riskLevel] || RISK_CONFIG.LOW;
    return <Badge variant="outline" className={config.className}>{config.label}</Badge>;
  };

  const formatTimeRange = (start: string, end: string) => {
    const fmt = (d: string) => new Date(d).toLocaleString("zh-CN", {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    return `${fmt(start)} ~ ${fmt(end)}`;
  };

  // ── 试剂领用表格 ──
  const renderRequisitionTable = (items: RequisitionWithDetails[], showActions: boolean) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>试剂名称</TableHead>
          <TableHead>数量</TableHead>
          <TableHead>用途</TableHead>
          <TableHead>申请人</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>申请时间</TableHead>
          {showActions && <TableHead>操作</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.length === 0 ? (
          <TableRow>
            <TableCell colSpan={showActions ? 7 : 6} className="py-8 text-center text-gray-500">暂无试剂领用申请</TableCell>
          </TableRow>
        ) : (
          items.map((req) => (
            <TableRow key={req.id}>
              <TableCell className="font-medium">{req.reagentName}</TableCell>
              <TableCell>{req.quantity}</TableCell>
              <TableCell className="max-w-48 truncate">{req.purpose || "-"}</TableCell>
              <TableCell>{req.applicantName}</TableCell>
              <TableCell>{renderStatusBadge(req.status)}</TableCell>
              <TableCell className="text-sm text-gray-500">{new Date(req.createdAt).toLocaleString("zh-CN")}</TableCell>
              {showActions && (
                <TableCell>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="border-green-500 text-green-600 hover:bg-green-50" disabled={reviewingId === req.id} onClick={() => handleApproveRequisition(req.id)}>
                      {reviewingId === req.id ? <Loader2 className="size-3 animate-spin" /> : "通过"}
                    </Button>
                    <Button size="sm" variant="outline" className="border-red-500 text-red-600 hover:bg-red-50" disabled={reviewingId === req.id} onClick={() => handleRejectRequisitionClick(req.id)}>
                      拒绝
                    </Button>
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );

  // ── 设备预约表格 ──
  const renderReservationTable = (items: ReservationWithDetails[], showActions: boolean) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>设备名称</TableHead>
          <TableHead>风险等级</TableHead>
          <TableHead>预约时段</TableHead>
          <TableHead>申请人</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>申请时间</TableHead>
          {showActions && <TableHead>操作</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.length === 0 ? (
          <TableRow>
            <TableCell colSpan={showActions ? 7 : 6} className="py-8 text-center text-gray-500">暂无设备预约申请</TableCell>
          </TableRow>
        ) : (
          items.map((res) => (
            <TableRow key={res.id}>
              <TableCell className="font-medium">
                <div>{res.device.name}</div>
                <div className="text-xs text-gray-400">{res.device.location || "-"}</div>
              </TableCell>
              <TableCell>{renderRiskBadge(res.device.riskLevel)}</TableCell>
              <TableCell className="text-sm">{formatTimeRange(res.startTime, res.endTime)}</TableCell>
              <TableCell>{res.user.name}</TableCell>
              <TableCell>{renderReservationStatusBadge(res.status)}</TableCell>
              <TableCell className="text-sm text-gray-500">{new Date(res.createdAt).toLocaleString("zh-CN")}</TableCell>
              {showActions && (
                <TableCell>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="border-green-500 text-green-600 hover:bg-green-50" disabled={reviewingId === res.id} onClick={() => handleApproveReservation(res.id)}>
                      {reviewingId === res.id ? <Loader2 className="size-3 animate-spin" /> : "通过"}
                    </Button>
                    <Button size="sm" variant="outline" className="border-red-500 text-red-600 hover:bg-red-50" disabled={reviewingId === res.id} onClick={() => handleRejectReservationClick(res.id)}>
                      拒绝
                    </Button>
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );

  const loadingEl = (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="size-6 animate-spin text-gray-400" />
      <span className="ml-2 text-gray-500">加载中...</span>
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {reviewError && (
        <Alert variant="destructive">
          <AlertDescription>{reviewError}</AlertDescription>
        </Alert>
      )}

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: "pending",
            label: `待审核 (${pendingRequisitions.length + pendingReservations.length})`,
            content: (
              <div className="space-y-4">
                {/* 试剂领用待审核 */}
                <Card>
                  <CardContent className="p-0">
                    <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm font-medium text-gray-700">
                      <FlaskConical className="size-4 text-teal-600" />
                      试剂领用申请
                      {pendingRequisitions.length > 0 && (
                        <Badge variant="outline" className="border-orange-500 text-orange-600">{pendingRequisitions.length}</Badge>
                      )}
                    </div>
                    {loading ? loadingEl : renderRequisitionTable(pendingRequisitions, true)}
                  </CardContent>
                </Card>
                {/* 设备预约待审核 */}
                <Card>
                  <CardContent className="p-0">
                    <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm font-medium text-gray-700">
                      <Cpu className="size-4 text-cyan-600" />
                      高危设备预约
                      {pendingReservations.length > 0 && (
                        <Badge variant="outline" className="border-orange-500 text-orange-600">{pendingReservations.length}</Badge>
                      )}
                    </div>
                    {loading ? loadingEl : renderReservationTable(pendingReservations, true)}
                  </CardContent>
                </Card>
              </div>
            ),
          },
          {
            key: "all",
            label: "全部申请",
            content: (
              <div className="space-y-4">
                <Card>
                  <CardContent className="p-0">
                    <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm font-medium text-gray-700">
                      <FlaskConical className="size-4 text-teal-600" />
                      试剂领用申请
                    </div>
                    {loading ? loadingEl : renderRequisitionTable(allRequisitions, false)}
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-0">
                    <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm font-medium text-gray-700">
                      <Cpu className="size-4 text-cyan-600" />
                      设备预约
                    </div>
                    {loading ? loadingEl : renderReservationTable(allReservations, false)}
                  </CardContent>
                </Card>
              </div>
            ),
          },
        ]}
      />

      <Dialog
        open={rejectDialogOpen}
        onOpenChange={setRejectDialogOpen}
        title="拒绝申请"
        description={rejectType === 'requisition' ? "请输入拒绝原因，便于反馈给申请人" : "请输入拒绝原因，便于反馈给申请人"}
        footer={
          <>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={handleRejectConfirm} disabled={reviewingId === rejectingId}>
              {reviewingId === rejectingId ? <Loader2 className="size-4 animate-spin" /> : null}
              确认拒绝
            </Button>
          </>
        }
      >
        <div className="py-2">
          <Textarea
            placeholder="请输入拒绝原因..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={4}
          />
        </div>
      </Dialog>
    </div>
  );
}
