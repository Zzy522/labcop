"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Download,
  Trash2,
  PenTool,
  X,
  Loader2,
  ImageOff,
  ZoomIn,
  MapPin,
  Package,
  Upload,
  ReceiptText,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from '@/arco-adapters/select';
import { Dialog } from '@/arco-adapters/dialog';
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Pagination } from "@/components/shared";
import { SmilesDrawerModal } from "@/components/smiles-drawer-modal";
import type { RiskLevel } from "@/types";
import { authFetch } from '@/lib/auth-fetch';
import { loadRDKit, filterBySubstructure, filterByExactMatch } from '@/lib/rdkit';
import { getStockDisplayText } from '@/lib/reagent-units';
import { ImportDialog } from '@/components/shared/import-dialog';
import { cn } from '@/lib/utils';
import { ReceiptLibraryDialog } from '@/components/reagents/receipt-library-dialog';

interface ReagentListItem {
  id: string;
  name: string;
  casNumber: string | null;
  brand: string | null;
  specification: string | null;
  riskLevel: RiskLevel;
  isHazardous: boolean;
  isControlled: boolean;
  storageLocation: string | null;
  stockQuantity: number;
  totalStockedBottles: number | null;
  minStock: number;
  unit: string | null;
  capacityPerUnit: number | null;
  capacityUnit: string | null;
  expiryDate: string | null;
  smiles: string | null;
  structureImgUrl: string | null;
  lab: { id: string; name: string } | null;
}

interface ReagentListResponse {
  data: ReagentListItem[];
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

const RISK_LEVEL_MAP: Record<RiskLevel, { label: string; className: string }> = {
  LOW: { label: "低风险", className: "bg-sky-100 text-sky-700 hover:bg-sky-100" },
  HIGH: { label: "高风险", className: "bg-red-100 text-red-700 hover:bg-red-100" },
};

function getStockStatus(quantity: number, minStock: number) {
  if (quantity === 0) return { label: "零库存", className: "bg-red-100 text-red-700 hover:bg-red-100", dotClass: "bg-red-500" };
  if (quantity <= minStock) return { label: "低库存", className: "bg-amber-100 text-amber-700 hover:bg-amber-100", dotClass: "bg-amber-500" };
  return { label: "正常", className: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100", dotClass: "bg-emerald-500" };
}

function getExpiryStatus(expiryDate: string | null) {
  if (!expiryDate) return null;
  const now = new Date();
  const expiry = new Date(expiryDate);
  const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { label: "已过期", className: "bg-red-100 text-red-700 hover:bg-red-100" };
  if (diffDays <= 30) return { label: "临期", className: "bg-amber-100 text-amber-700 hover:bg-amber-100" };
  return null;
}

// ─── 站内结构式图片 URL：服务端 RDKit 优先、PubChem 降级 ───
function getStructureImageUrl(reagent: ReagentListItem): string | null {
  if (!reagent.smiles && !reagent.structureImgUrl && !reagent.casNumber) return null;
  return `/api/reagents/${encodeURIComponent(reagent.id)}/structure`;
}

export default function AdminReagentsPage() {
  const router = useRouter();

  const [archived, setArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [riskLevel, setRiskLevel] = useState<string | undefined>(undefined);
  const [isHazardous, setIsHazardous] = useState<string | undefined>(undefined);
  const [isControlled, setIsControlled] = useState<string | undefined>(undefined);
  const [storageLocation, setStorageLocation] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // SMILES 化学式查询相关状态
  const [smilesSearch, setSmilesSearch] = useState<string>("");
  const [smilesMode, setSmilesMode] = useState<"exact" | "substructure">("exact");
  const [smilesDrawerOpen, setSmilesDrawerOpen] = useState(false);
  const [activeSmilesFilter, setActiveSmilesFilter] = useState<{ smiles: string; mode: "exact" | "substructure" } | null>(null);

  // RDKit 子结构匹配
  const [rdkit, setRdkit] = useState<any>(null);
  const [rdkitLoading, setRdkitLoading] = useState(false);
  const [rdkitError, setRdkitError] = useState("");

  // 结构式大图
  const [enlargedImg, setEnlargedImg] = useState<{ url: string; name: string } | null>(null);

  // 搜索防抖：300ms 延迟
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  // 精准/子结构搜索均需加载 RDKit WASM
  useEffect(() => {
    if (activeSmilesFilter && !rdkit && !rdkitLoading) {
      setRdkitLoading(true);
      setRdkitError("");
      loadRDKit().then(setRdkit).catch((e) => {
        console.error('RDKit load failed:', e);
        setRdkitError(e instanceof Error ? e.message : "RDKit 加载失败");
      }).finally(() => setRdkitLoading(false));
    }
  }, [activeSmilesFilter, rdkit, rdkitLoading]);

  const queryParams = new URLSearchParams();
  if (archived) queryParams.set("archived", "true");
  if (debouncedSearch) queryParams.set("search", debouncedSearch);
  if (riskLevel) queryParams.set("riskLevel", riskLevel);
  if (isHazardous) queryParams.set("isHazardous", isHazardous);
  if (isControlled) queryParams.set("isControlled", isControlled);
  if (storageLocation) queryParams.set("storageLocation", storageLocation);
  if (activeSmilesFilter) {
    queryParams.set("smilesSearch", activeSmilesFilter.smiles);
    queryParams.set("smilesMode", activeSmilesFilter.mode);
  }
  queryParams.set("page", String(page));
  // 精准/子结构搜索均需全部数据在前端用 RDKit 过滤
  const effectivePageSize = activeSmilesFilter ? 500 : pageSize;
  queryParams.set("pageSize", String(effectivePageSize));

  const {
    data: response,
    isLoading,
    isError,
    error,
  } = useQuery<ReagentListResponse>({
    queryKey: ["reagents", archived, debouncedSearch, riskLevel, isHazardous, isControlled, storageLocation, activeSmilesFilter, page],
    queryFn: async () => {
      const res = await authFetch(`/api/reagents?${queryParams.toString()}`);
      if (!res.ok) throw new Error("获取试剂数据失败");
      return res.json();
    },
  });

  // RDKit 化学匹配过滤（精准=Canonical SMILES 比对，子结构=子图同构匹配）
  const filteredData = useMemo(() => {
    const data = response?.data ?? [];
    if (!activeSmilesFilter || !rdkit || !activeSmilesFilter.smiles) return data;
    if (activeSmilesFilter.mode === 'exact') {
      return filterByExactMatch(rdkit, data, activeSmilesFilter.smiles, (r: ReagentListItem) => r.smiles);
    }
    return filterBySubstructure(rdkit, data, activeSmilesFilter.smiles, (r: ReagentListItem) => r.smiles);
  }, [response, activeSmilesFilter, rdkit]);

  const queryClient = useQueryClient();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingReagent, setDeletingReagent] = useState<ReagentListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [receiptLibraryOpen, setReceiptLibraryOpen] = useState(false);

  const handleDeleteClick = (reagent: ReagentListItem) => {
    setDeletingReagent(reagent);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingReagent) return;
    setDeleting(true);
    try {
      const res = await authFetch(`/api/reagents/${deletingReagent.id}`, { method: archived ? "PATCH" : "DELETE", ...(archived ? { body: JSON.stringify({ action: "RESTORE" }) } : {}) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `删除失败 (${res.status})` }));
        throw new Error(err.error || "删除失败");
      }
      setDeleteDialogOpen(false);
      setDeletingReagent(null);
      queryClient.invalidateQueries({ queryKey: ["reagents"] });
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  };

  // 化学式查询回调
  const handleSmilesSearch = (smiles: string, mode: "exact" | "substructure") => {
    setSmilesSearch(smiles);
    setSmilesMode(mode);
    setActiveSmilesFilter({ smiles, mode });
    setSmilesDrawerOpen(false);
    setPage(1);
  };

  // 清除 SMILES 过滤
  const handleClearSmilesFilter = () => {
    setSmilesSearch("");
    setSmilesMode("exact");
    setActiveSmilesFilter(null);
    setPage(1);
  };

  // 点击结构式查看大图
  const handleStructureClick = (reagent: ReagentListItem) => {
    const url = getStructureImageUrl(reagent);
    if (url) setEnlargedImg({ url, name: reagent.name });
  };

  const handleExport = useCallback(() => {
    const data = filteredData;
    const headers = ["名称", "CAS号", "品牌", "风险等级", "危化品", "管制品", "存储位置", "库存", "单位", "有效期", "SMILES", "实验室"];
    const rows = data.map((r) => [
      r.name,
      r.casNumber ?? "",
      r.brand ?? "",
      RISK_LEVEL_MAP[r.riskLevel]?.label ?? r.riskLevel,
      r.isHazardous ? "是" : "否",
      r.isControlled ? "是" : "否",
      r.storageLocation ?? "",
      r.stockQuantity,
      r.unit ?? "",
      r.expiryDate ? new Date(r.expiryDate).toLocaleDateString("zh-CN") : "",
      r.smiles ?? "",
      r.lab?.name ?? "",
    ]);
    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");
    const BOM = "\uFEFF";
    const blob = new Blob([BOM + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `试剂列表_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredData]);

  const totalPages = response ? response.pagination.totalPages : 0;

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-gray-200 shadow-sm">
        <CardContent className="p-4">
          {/* 筛选器：一行紧凑布局 */}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="搜索名称或 CAS 号"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-56"
            />
            <Select
              value={riskLevel ?? ""}
              onChange={(v: string) => { setRiskLevel(v === "ALL" ? undefined : (v || undefined)); setPage(1); }}
              placeholder="风险等级"
              options={[
                { value: "ALL", label: "全部风险" },
                { value: "LOW", label: "低风险" },
                { value: "HIGH", label: "高风险" },
              ]}
              style={{ width: 112 }}
            />
            <Select
              value={isHazardous ?? ""}
              onChange={(v: string) => { setIsHazardous(v === "ALL" ? undefined : (v || undefined)); setPage(1); }}
              placeholder="危化品"
              options={[
                { value: "ALL", label: "全部危化" },
                { value: "true", label: "危化品" },
                { value: "false", label: "非危化" },
              ]}
              style={{ width: 112 }}
            />
            <Select
              value={isControlled ?? ""}
              onChange={(v: string) => { setIsControlled(v === "ALL" ? undefined : (v || undefined)); setPage(1); }}
              placeholder="管制品"
              options={[
                { value: "ALL", label: "全部管制" },
                { value: "true", label: "管制品" },
                { value: "false", label: "非管制" },
              ]}
              style={{ width: 112 }}
            />
            <Input
              placeholder="存储位置"
              value={storageLocation}
              onChange={(e) => { setStorageLocation(e.target.value); setPage(1); }}
              className="h-9 w-36"
            />
            <Button
              variant="outline"
              className="h-9 border-cyan-400 text-cyan-700 hover:bg-cyan-50 hover:text-cyan-800"
              onClick={() => setSmilesDrawerOpen(true)}
            >
              <PenTool className="size-4" />
              化学式查询
            </Button>
            <div className="flex-1" />
            <Button variant="outline" className="h-9 border-cyan-200 text-cyan-700 hover:bg-cyan-50 hover:text-cyan-800" onClick={() => setReceiptLibraryOpen(true)}>
              <ReceiptText className="size-4" />
              票据库
            </Button>
            <Button className="h-9 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700" onClick={() => router.push("/admin/reagents/new")}>
              <Plus className="size-4" />
              新增试剂
            </Button>
            <Button variant="outline" className="h-9" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" />
              导入
            </Button>
            <Button variant="outline" className="h-9" onClick={handleExport} disabled={!filteredData.length}>
              <Download className="size-4" />
              导出
            </Button>
          </div>

          {/* 批量导入对话框 */}
          <ImportDialog
            open={importOpen}
            onOpenChange={setImportOpen}
            title="批量导入试剂"
            templateUrl="/api/reagents/import"
            importUrl="/api/reagents/import"
            onImported={() => queryClient.invalidateQueries({ queryKey: ["reagents"] })}
          />
          <Button variant="outline" onClick={() => { setArchived(!archived); setPage(1); }}>{archived ? "返回在用试剂" : "查看已归档（可恢复）"}</Button>
            <ReceiptLibraryDialog open={receiptLibraryOpen} onOpenChange={setReceiptLibraryOpen} />

          {/* 活跃 SMILES 过滤提示条 */}
          {activeSmilesFilter && (
            <div className="mt-3 flex items-center gap-2 rounded-md border border-cyan-300 bg-cyan-50 px-3 py-2 text-xs">
              <PenTool className="size-3.5 text-cyan-700" />
              <span className="font-medium text-cyan-800">
                {activeSmilesFilter.mode === "exact" ? "精准匹配" : "子结构匹配"}：
              </span>
              <code className="rounded bg-white px-2 py-0.5 font-mono text-cyan-900">
                {activeSmilesFilter.smiles}
              </code>
              {activeSmilesFilter.mode === "substructure" && rdkitLoading && (
                <span className="flex items-center gap-1 text-cyan-600">
                  <Loader2 className="size-3 animate-spin" /> RDKit 加载中...
                </span>
              )}
              {activeSmilesFilter.mode === "substructure" && rdkitError && (
                <span className="text-red-500">RDKit 加载失败：{rdkitError}</span>
              )}
              <button
                type="button"
                onClick={handleClearSmilesFilter}
                className="ml-auto inline-flex size-5 items-center justify-center rounded-full text-cyan-700 hover:bg-cyan-200"
                aria-label="清除化学式过滤"
              >
                <X className="size-3" />
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {isError && (
        <Alert variant="destructive">
          <AlertTitle>加载失败</AlertTitle>
          <AlertDescription>{error instanceof Error ? error.message : "未知错误"}</AlertDescription>
        </Alert>
      )}

      <Card className="overflow-hidden border-gray-200 shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-gray-400" />
              <span className="ml-2 text-sm text-gray-500">加载中...</span>
            </div>
          ) : !filteredData.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Package className="size-10 text-gray-300 mb-2" />
              <p className="text-sm text-gray-400 mb-3">暂无试剂数据</p>
              <Button size="sm" onClick={() => router.push("/admin/reagents/new")}>
                <Plus className="size-4" />
                新增试剂
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[1180px] w-full text-sm">
                <thead className="bg-slate-50 [&_tr]:border-b [&_tr]:border-gray-200 [&_th]:!h-11 [&_th]:!px-3 [&_th]:!py-0 [&_th]:!text-sm [&_th]:!font-semibold [&_th]:!text-slate-600">
                  <tr>
                    <th className="border-b border-slate-100 px-4 py-3 text-center whitespace-nowrap">结构式</th>
                    <th className="border-b border-slate-100 px-4 py-3 text-center whitespace-nowrap">试剂名称</th>
                    <th className="border-b border-slate-100 px-4 py-3 text-center whitespace-nowrap">CAS 号</th>
                    <th className="border-b border-slate-100 px-4 py-3 text-center whitespace-nowrap">风险等级</th>
                    <th className="border-b border-slate-100 px-4 py-3 text-center whitespace-nowrap">管制</th>
                    <th className="border-b border-slate-100 px-4 py-3 text-center whitespace-nowrap">库存</th>
                    <th className="border-b border-slate-100 px-4 py-3 text-center whitespace-nowrap">存储位置</th>
                    <th className="border-b border-slate-100 px-4 py-3 text-center whitespace-nowrap">有效期</th>
                    <th className="border-b border-slate-100 px-4 py-3 text-center whitespace-nowrap">状态</th>
                    <th className="border-b border-slate-100 px-4 py-3 text-center whitespace-nowrap">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredData.map((reagent) => {
                    const stockStatus = getStockStatus(reagent.stockQuantity, reagent.minStock);
                    const expiryStatus = getExpiryStatus(reagent.expiryDate);
                    // 库存展示：主显示剩余总量（质量/体积），副显示单瓶容量规格
                    // 不显示剩余瓶数，避免浮点精度问题
                    const stockDisplay = getStockDisplayText({
                      stockQuantity: reagent.stockQuantity,
                      unit: reagent.unit,
                      capacityPerUnit: reagent.capacityPerUnit,
                      capacityUnit: reagent.capacityUnit,
                      totalStockedBottles: reagent.totalStockedBottles,
                    });
                    return (
                      <tr
                        key={reagent.id}
                        className="cursor-pointer hover:bg-gray-50/60 transition-colors"
                        onClick={() => router.push(`/admin/reagents/${reagent.id}`)}
                      >
                        {/* 结构式（可点击查看大图） */}
                        <td className="px-4 py-3 text-center">
                          <StructureImage reagent={reagent} onClick={() => handleStructureClick(reagent)} />
                        </td>
                        {/* 试剂名称 */}
                        <td className="px-3 py-3 text-center max-w-[160px]">
                          <div className="inline-flex flex-col items-center gap-1">
                            <span className="font-medium text-gray-900 break-all leading-snug">
                              {reagent.name}
                            </span>
                            <div className="flex flex-wrap items-center justify-center gap-1">
                              {reagent.isHazardous && (
                                <Badge className="bg-red-100 text-red-700 text-[10px] px-1.5 py-0 hover:bg-red-100">危</Badge>
                              )}
                              {reagent.smiles && (
                                <Badge
                                  variant="outline"
                                  className="border-cyan-300 bg-cyan-50 text-[10px] text-cyan-700 hover:bg-cyan-50"
                                  title={`SMILES: ${reagent.smiles}`}
                                >
                                  SMILES
                                </Badge>
                              )}
                            </div>
                          </div>
                        </td>
                        {/* CAS 号 */}
                        <td className="px-3 py-3 text-center text-gray-600 font-mono">
                          {reagent.casNumber ?? "-"}
                        </td>
                        {/* 风险等级 */}
                        <td className="px-3 py-3 text-center">
                          <Badge className={RISK_LEVEL_MAP[reagent.riskLevel]?.className}>
                            {RISK_LEVEL_MAP[reagent.riskLevel]?.label ?? reagent.riskLevel}
                          </Badge>
                        </td>
                        {/* 管制 */}
                        <td className="px-3 py-3 text-center">
                          {reagent.isControlled ? (
                            <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100">管制品</Badge>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        {/* 库存 */}
                        <td className="px-3 py-3 text-center">
                          <div className="inline-flex flex-col items-center gap-0.5">
                            <span className={cn(
                              "font-semibold",
                              stockStatus.label === "正常" ? "text-gray-700" :
                              stockStatus.label === "低库存" ? "text-amber-600" : "text-red-600"
                            )}>
                              {stockDisplay.primary}
                            </span>
                            {stockDisplay.secondary && (
                              <span className="text-[10px] text-gray-400">
                                {stockDisplay.secondary}
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1">
                              <span className={cn("size-1.5 rounded-full", stockStatus.dotClass)} />
                              <span className="text-gray-400">{stockStatus.label}</span>
                            </span>
                          </div>
                        </td>
                        {/* 存储位置 */}
                        <td className="px-3 py-3 text-center">
                          {reagent.storageLocation ? (
                            <div className="inline-flex items-center gap-1 text-gray-600">
                              <MapPin className="size-3 text-gray-400" />
                              <span>{reagent.storageLocation}</span>
                            </div>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        {/* 有效期 */}
                        <td className="px-3 py-3 text-center text-gray-600 whitespace-nowrap">
                          {reagent.expiryDate
                            ? new Date(reagent.expiryDate).toLocaleDateString("zh-CN")
                            : "-"}
                        </td>
                        {/* 状态 */}
                        <td className="px-3 py-3 text-center">
                          {expiryStatus ? (
                            <Badge className={expiryStatus.className}>{expiryStatus.label}</Badge>
                          ) : (
                            <Badge variant="secondary">正常</Badge>
                          )}
                        </td>
                        {/* 操作 */}
                        <td className="px-3 py-3 text-center">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 hover:bg-red-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteClick(reagent);
                            }}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {response && response.pagination.total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>共 {response.pagination.total} 条记录</span>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}

      {/* 结构式大图 Lightbox */}
      {enlargedImg && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-8"
          onClick={() => setEnlargedImg(null)}
        >
          <div className="mb-3 max-w-2xl text-center">
            <span className="rounded-md bg-black/50 px-4 py-1.5 text-sm font-medium text-white">
              {enlargedImg.name}
            </span>
          </div>
          <div className="relative max-w-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={enlargedImg.url}
              alt={`${enlargedImg.name} 结构式`}
              className="max-w-full max-h-[70vh] rounded-lg bg-white p-4 shadow-2xl"
            />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setEnlargedImg(null); }}
              className="absolute top-3 right-3 rounded-full bg-white/20 p-2 text-white transition-colors hover:bg-white/30"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>
      )}

      <Dialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={archived ? "恢复试剂" : "归档试剂"}
        description={`确定要归档 / 恢复试剂「${deletingReagent?.name}」吗？数据和历史记录保留，可在已归档列表恢复。`}
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={handleDeleteConfirm} disabled={deleting}>
              {deleting ? "处理中..." : archived ? "确认恢复" : "确认归档"}
            </Button>
          </>
        }
      >
        <div className="py-2 text-sm text-gray-500">
          归档后停止新的领用，库存、台账和票据原件全部保留。
        </div>
      </Dialog>

      {/* 化学式绘制查询弹窗 */}
      <SmilesDrawerModal
        open={smilesDrawerOpen}
        onClose={() => setSmilesDrawerOpen(false)}
        onSearch={handleSmilesSearch}
        initialSmiles={smilesSearch}
        title="化学式查询试剂"
      />
    </div>
  );
}

// ─── 结构式图片组件（RDKit 优先 + PubChem 降级 + 懒加载 + 可点击大图）───
function StructureImage({ reagent, onClick }: { reagent: ReagentListItem; onClick?: () => void }) {
  const [errored, setErrored] = useState(false);
  const url = getStructureImageUrl(reagent);

  if (!url || errored) {
    return (
      <div className="mx-auto flex size-28 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-300">
        <ImageOff className="size-7" />
      </div>
    );
  }

  // 有 onClick 时渲染为可点击按钮（带 hover 效果和放大图标）
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title="点击查看大图"
        className="group relative mx-auto size-28 overflow-hidden rounded-xl border border-slate-200 bg-white transition-all hover:border-cyan-300 hover:shadow-md"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={`${reagent.name} 结构式`}
          title={reagent.casNumber ? `CAS: ${reagent.casNumber}` : reagent.name}
          loading="lazy"
          className="size-full scale-125 object-contain p-0.5"
          onError={() => setErrored(true)}
        />
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100">
          <ZoomIn className="size-6 text-white" />
        </span>
      </button>
    );
  }

  return (
    <div className="mx-auto size-28 overflow-hidden rounded-xl border border-slate-200 bg-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={`${reagent.name} 结构式`}
        title={reagent.casNumber ? `CAS: ${reagent.casNumber}` : reagent.name}
        loading="lazy"
        className="size-full scale-125 object-contain p-0.5"
        onError={() => setErrored(true)}
      />
    </div>
  );
}
