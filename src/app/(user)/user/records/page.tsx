"use client";

import { useState, useEffect, useCallback } from "react";
import { History, Loader2, Filter } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/arco-adapters/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs } from "@/arco-adapters/tabs";
import { useAuthStore } from "@/store/auth-store";
import { authFetch } from "@/lib/auth-fetch";

type ActivityType = "REAGENT_IN" | "REAGENT_OUT" | "DEVICE_USE" | "OTHER";

interface ActivityRecord {
  id: string;
  type: ActivityType;
  detail: string;
  operator: string;
  createdAt: string;
  status?: string;
}

const TYPE_CONFIG: Record<ActivityType, { label: string; className: string }> = {
  REAGENT_IN: { label: "试剂入库", className: "bg-blue-100 text-blue-700" },
  REAGENT_OUT: { label: "试剂领用", className: "bg-teal-100 text-teal-700" },
  DEVICE_USE: { label: "设备使用", className: "bg-indigo-100 text-indigo-700" },
  OTHER: { label: "其他", className: "bg-gray-100 text-gray-700" },
};

function mapActivityType(type: string): ActivityType {
  if (type.includes("入库") || type.includes("STOCK_IN")) return "REAGENT_IN";
  if (type.includes("出库") || type.includes("STOCK_OUT")) return "REAGENT_OUT";
  if (type.includes("领用")) return "REAGENT_OUT";
  if (type.includes("设备")) return "DEVICE_USE";
  return "OTHER";
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin}分钟前`;
  if (diffHour < 24) return `${diffHour}小时前`;
  if (diffDay < 7) return `${diffDay}天前`;
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

export default function RecordsPage() {
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;
  const [allRecords, setAllRecords] = useState<ActivityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const fetchRecords = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // 并行获取当前用户的领用申请记录和设备列表
      const [reqRes, devRes] = await Promise.all([
        authFetch(`/api/requisitions?applicantId=${userId}&pageSize=20`),
        authFetch("/api/devices?pageSize=20"),
      ]);

      const records: ActivityRecord[] = [];

      // 领用申请记录 → 试剂领用
      if (reqRes.ok) {
        const reqData = await reqRes.json();
        const requisitions: Array<{
          id: string; quantity: number; purpose: string; status: string; createdAt: string;
          reagent?: { name: string };
          applicant?: { name: string };
        }> = reqData.data ?? [];
        for (const req of requisitions) {
          records.push({
            id: req.id,
            type: mapActivityType("领用"),
            detail: `${req.reagent?.name ?? "未知试剂"} × ${req.quantity}${req.purpose ? ` — ${req.purpose}` : ""}`,
            operator: req.applicant?.name ?? "-",
            createdAt: req.createdAt,
            status: req.status,
          });
        }
      }

      // 设备列表 → 设备使用记录
      if (devRes.ok) {
        const devData = await devRes.json();
        const devices: Array<{
          id: string; name: string; model?: string | null; status: string;
          location?: string | null; createdAt: string;
        }> = devData.data ?? [];
        for (const dev of devices) {
          records.push({
            id: `dev-${dev.id}`,
            type: mapActivityType("设备"),
            detail: `${dev.name}${dev.model ? ` (${dev.model})` : ""}${dev.location ? ` — ${dev.location}` : ""}`,
            operator: "-",
            createdAt: dev.createdAt,
            status: dev.status,
          });
        }
      }

      // 按时间倒序排列
      records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setAllRecords(records);
    } catch (error) {
      console.error("加载记录失败:", error);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const filteredRecords = allRecords.filter((r) => {
    if (typeFilter !== "all" && r.type !== typeFilter) return false;
    if (activeTab === "reagent" && r.type !== "REAGENT_IN" && r.type !== "REAGENT_OUT") return false;
    if (activeTab === "equipment" && r.type !== "DEVICE_USE") return false;
    if (activeTab === "safety" && r.type !== "OTHER") return false;
    return true;
  });

  const renderTable = (records: ActivityRecord[]) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>类型</TableHead>
          <TableHead>详情</TableHead>
          <TableHead>操作人</TableHead>
          <TableHead>时间</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {records.length === 0 ? (
          <TableRow>
            <TableCell colSpan={4} className="py-8 text-center text-gray-500">暂无记录</TableCell>
          </TableRow>
        ) : (
          records.map((record) => (
            <TableRow key={record.id}>
              <TableCell>
                <Badge variant="outline" className={TYPE_CONFIG[record.type]?.className ?? "bg-gray-100 text-gray-700"}>
                  {TYPE_CONFIG[record.type]?.label ?? record.type}
                </Badge>
              </TableCell>
              <TableCell className="max-w-64 truncate text-sm">{record.detail}</TableCell>
              <TableCell className="text-sm text-gray-600">{record.operator}</TableCell>
              <TableCell className="text-sm text-gray-500">{formatTime(record.createdAt)}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );

  return (
    <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
          </div>
        <div className="flex items-center gap-2">
          <Filter className="size-4 text-gray-400" />
          <Select
            value={typeFilter}
            onChange={(val) => setTypeFilter(val || "all")}
            placeholder="类型筛选"
            options={[
              { value: "all", label: "全部类型" },
              { value: "REAGENT_IN", label: "试剂入库" },
              { value: "REAGENT_OUT", label: "试剂领用" },
              { value: "DEVICE_USE", label: "设备使用" },
              { value: "OTHER", label: "其他" },
            ]}
            className="w-32"
          />
        </div>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: "all",
            label: "全部",
            content: (
              <Card><CardContent className="p-0">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="size-6 animate-spin text-gray-400" />
                  </div>
                ) : renderTable(filteredRecords)}
              </CardContent></Card>
            ),
          },
          {
            key: "reagent",
            label: "试剂相关",
            content: (
              <Card><CardContent className="p-0">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="size-6 animate-spin text-gray-400" />
                  </div>
                ) : renderTable(filteredRecords)}
              </CardContent></Card>
            ),
          },
          {
            key: "equipment",
            label: "设备相关",
            content: (
              <Card><CardContent className="p-0">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="size-6 animate-spin text-gray-400" />
                  </div>
                ) : renderTable(filteredRecords)}
              </CardContent></Card>
            ),
          },
          {
            key: "safety",
            label: "安全相关",
            content: (
              <Card><CardContent className="p-0">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="size-6 animate-spin text-gray-400" />
                  </div>
                ) : renderTable(filteredRecords)}
              </CardContent></Card>
            ),
          },
        ]}
      />
    </div>
  );
}
