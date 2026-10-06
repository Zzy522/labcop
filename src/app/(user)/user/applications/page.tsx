"use client";

import { useState, useEffect, useCallback } from "react";
import { FileText, Loader2, Calendar } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs } from "@/arco-adapters/tabs";
import type { RequisitionStatus } from "@/types";
import { authFetch } from "@/lib/auth-fetch";

const STATUS_CONFIG: Record<RequisitionStatus, { label: string; className: string }> = {
  PENDING: { label: "待处理", className: "border-gray-400 text-gray-600 bg-gray-50" },
  APPROVED: { label: "已通过", className: "border-green-500 text-green-600 bg-green-50" },
  NEEDS_CONFIRM: { label: "待确认", className: "border-orange-500 text-orange-600 bg-orange-50" },
  BLOCKED: { label: "已阻断", className: "border-red-500 text-red-600 bg-red-50" },
  REJECTED: { label: "已拒绝", className: "border-purple-500 text-purple-600 bg-purple-50" },
};

// 设备预约状态配置
const RESERVATION_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  PENDING: { label: "待审批", className: "border-amber-400 text-amber-600 bg-amber-50" },
  APPROVED: { label: "已通过", className: "border-green-500 text-green-600 bg-green-50" },
  ACTIVE: { label: "使用中", className: "border-blue-500 text-blue-600 bg-blue-50" },
  COMPLETED: { label: "已完成", className: "border-gray-400 text-gray-600 bg-gray-50" },
  CANCELLED: { label: "已取消", className: "border-gray-300 text-gray-500 bg-gray-50" },
  REJECTED: { label: "已拒绝", className: "border-red-500 text-red-600 bg-red-50" },
};

interface RequisitionWithDetails {
  id: string;
  reagentId: string;
  reagentName: string;
  applicantId: string;
  applicantName: string;
  quantity: number;
  purpose: string;
  status: RequisitionStatus;
  createdAt: string;
}

interface ReservationWithDetails {
  id: string;
  deviceId: string;
  deviceName: string;
  startTime: string;
  endTime: string;
  purpose: string;
  status: string;
  createdAt: string;
  note?: string | null;
}

export default function ApplicationsPage() {
  const [allRequisitions, setAllRequisitions] = useState<RequisitionWithDetails[]>([]);
  const [allReservations, setAllReservations] = useState<ReservationWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [reservationsLoading, setReservationsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("all");
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  const fetchRequisitions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch("/api/requisitions?pageSize=50");
      if (res.ok) {
        const data = await res.json();
        setAllRequisitions(
          data.data.map((r: Record<string, unknown>) => ({
            id: r.id as string,
            reagentId: r.reagentId as string,
            reagentName: (r.reagent as Record<string, unknown>)?.name as string ?? "未知试剂",
            applicantId: r.applicantId as string,
            applicantName: (r.applicant as Record<string, unknown>)?.name as string ?? "未知用户",
            quantity: r.quantity as number,
            purpose: (r.purpose as string) ?? "",
            status: r.status as RequisitionStatus,
            createdAt: r.createdAt as string,
          }))
        );
      }
    } catch (error) {
      console.error("加载申请数据失败:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchReservations = useCallback(async () => {
    setReservationsLoading(true);
    try {
      const res = await authFetch("/api/reservations/mine");
      if (res.ok) {
        const data = await res.json();
        setAllReservations(
          (data.data ?? []).map((r: Record<string, unknown>) => ({
            id: r.id as string,
            deviceId: (r.device as Record<string, unknown>)?.id as string ?? r.deviceId as string,
            deviceName: (r.device as Record<string, unknown>)?.name as string ?? "未知设备",
            startTime: r.startTime as string,
            endTime: r.endTime as string,
            purpose: (r.purpose as string) ?? "",
            status: r.status as string,
            createdAt: r.createdAt as string,
            note: (r.note as string) ?? null,
          }))
        );
      }
    } catch (error) {
      console.error("加载预约数据失败:", error);
    } finally {
      setReservationsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRequisitions();
    fetchReservations();
  }, [fetchRequisitions, fetchReservations]);

  const pendingItems = allRequisitions.filter((r) => r.status === "PENDING" || r.status === "NEEDS_CONFIRM");
  const completedItems = allRequisitions.filter((r) => r.status === "APPROVED" || r.status === "REJECTED" || r.status === "BLOCKED");

  const pendingReservations = allReservations.filter((r) => r.status === "PENDING" || r.status === "APPROVED" || r.status === "ACTIVE");
  const completedReservations = allReservations.filter((r) => r.status === "COMPLETED" || r.status === "CANCELLED" || r.status === "REJECTED");

  const handleCancelReservation = async (reservationId: string) => {
    setCancelingId(reservationId);
    try {
      const res = await authFetch(`/api/reservations/${reservationId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "CANCEL" }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "取消失败");
      }
      fetchReservations();
    } catch (err) {
      alert(err instanceof Error ? err.message : "取消预约失败");
    } finally {
      setCancelingId(null);
    }
  };

  const formatDateTime = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString("zh-CN", { hour12: false });
    } catch {
      return dateStr;
    }
  };

  const renderRequisitionTable = (items: RequisitionWithDetails[]) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>试剂名称</TableHead>
          <TableHead>数量</TableHead>
          <TableHead>用途</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>申请时间</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="py-8 text-center text-gray-500">暂无数据</TableCell>
          </TableRow>
        ) : (
          items.map((req) => (
            <TableRow key={req.id}>
              <TableCell className="font-medium">{req.reagentName}</TableCell>
              <TableCell>{req.quantity}</TableCell>
              <TableCell className="max-w-48 truncate">{req.purpose || "-"}</TableCell>
              <TableCell>
                <Badge variant="outline" className={STATUS_CONFIG[req.status]?.className}>
                  {STATUS_CONFIG[req.status]?.label ?? req.status}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-gray-500">{new Date(req.createdAt).toLocaleString("zh-CN")}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );

  const renderReservationTable = (items: ReservationWithDetails[]) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>设备名称</TableHead>
          <TableHead>开始时间</TableHead>
          <TableHead>结束时间</TableHead>
          <TableHead>用途</TableHead>
          <TableHead>状态</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="py-8 text-center text-gray-500">暂无预约记录</TableCell>
          </TableRow>
        ) : (
          items.map((r) => {
            const statusInfo = RESERVATION_STATUS_CONFIG[r.status] ?? { label: r.status, className: "" };
            const canCancel = r.status === "PENDING" || r.status === "APPROVED";
            return (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.deviceName}</TableCell>
                <TableCell className="text-sm">{formatDateTime(r.startTime)}</TableCell>
                <TableCell className="text-sm">{formatDateTime(r.endTime)}</TableCell>
                <TableCell className="max-w-48 truncate">{r.purpose || "-"}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={statusInfo.className}>{statusInfo.label}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  {canCancel ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 border-red-200 hover:bg-red-50"
                      disabled={cancelingId === r.id}
                      onClick={() => handleCancelReservation(r.id)}
                    >
                      {cancelingId === r.id ? "取消中..." : "取消"}
                    </Button>
                  ) : (
                    <span className="text-sm text-gray-400">-</span>
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
          {
            key: "all",
            label: "全部",
            content: (
              <div className="space-y-4">
                <Card>
                  <CardContent className="p-0">
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                      <FileText className="size-4 text-gray-400" />
                      <span className="text-sm font-semibold text-gray-700">试剂领用申请</span>
                    </div>
                    {loading ? <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-gray-400" /></div> : renderRequisitionTable(allRequisitions)}
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-0">
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                      <Calendar className="size-4 text-gray-400" />
                      <span className="text-sm font-semibold text-gray-700">设备预约</span>
                    </div>
                    {reservationsLoading ? <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-gray-400" /></div> : renderReservationTable(allReservations)}
                  </CardContent>
                </Card>
              </div>
            ),
          },
          {
            key: "pending",
            label: "进行中",
            content: (
              <div className="space-y-4">
                <Card>
                  <CardContent className="p-0">
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                      <FileText className="size-4 text-gray-400" />
                      <span className="text-sm font-semibold text-gray-700">试剂领用申请</span>
                    </div>
                    {loading ? <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-gray-400" /></div> : renderRequisitionTable(pendingItems)}
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-0">
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                      <Calendar className="size-4 text-gray-400" />
                      <span className="text-sm font-semibold text-gray-700">设备预约</span>
                    </div>
                    {reservationsLoading ? <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-gray-400" /></div> : renderReservationTable(pendingReservations)}
                  </CardContent>
                </Card>
              </div>
            ),
          },
          {
            key: "completed",
            label: "已完成",
            content: (
              <div className="space-y-4">
                <Card>
                  <CardContent className="p-0">
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                      <FileText className="size-4 text-gray-400" />
                      <span className="text-sm font-semibold text-gray-700">试剂领用申请</span>
                    </div>
                    {loading ? <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-gray-400" /></div> : renderRequisitionTable(completedItems)}
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-0">
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                      <Calendar className="size-4 text-gray-400" />
                      <span className="text-sm font-semibold text-gray-700">设备预约</span>
                    </div>
                    {reservationsLoading ? <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-gray-400" /></div> : renderReservationTable(completedReservations)}
                  </CardContent>
                </Card>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
