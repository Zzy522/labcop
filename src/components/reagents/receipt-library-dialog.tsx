"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, FileText, Loader2, ReceiptText, Search, X } from "lucide-react";
import { Dialog } from "@/arco-adapters/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/shared";
import { authFetch } from "@/lib/auth-fetch";
import { cn } from "@/lib/utils";

interface ReceiptRecord {
  id: string;
  fileName: string;
  mimeType: string | null;
  fileSize: number | null;
  status: string;
  processingMode: string;
  receiptDate: string | null;
  archiveNote: string | null;
  reagentId: string | null;
  reagentName: string | null;
  casNumber: string | null;
  brand: string | null;
  riskLevel: string | null;
  isHazardous: boolean | null;
  isControlled: boolean | null;
  uploadedBy: { id: string; name: string; email: string };
  createdAt: string;
  hasOriginal: boolean;
}

interface ReceiptResponse {
  data: ReceiptRecord[];
  pagination: { total: number; page: number; pageSize: number; totalPages: number };
  filterOptions: { uploaders: Array<{ id: string; name: string; email: string }> };
}

interface ReceiptFilters {
  query: string;
  uploadedById: string;
  startDate: string;
  endDate: string;
  riskLevel: string;
  isHazardous: string;
  isControlled: string;
  status: string;
  processingMode: string;
}

const EMPTY_FILTERS: ReceiptFilters = {
  query: "",
  uploadedById: "",
  startDate: "",
  endDate: "",
  riskLevel: "",
  isHazardous: "",
  isControlled: "",
  status: "",
  processingMode: "",
};

const STATUS_LABELS: Record<string, string> = {
  QUEUED: "排队中",
  PROCESSING: "识别中",
  PENDING: "待确认",
  CONFIRMED: "已入库",
  SKIPPED: "不入库",
  REJECTED: "识别失败",
};

const MODE_LABELS: Record<string, string> = {
  OCR: "OCR 智能入库",
  MANUAL_ARCHIVE: "手工票据入库",
  ARCHIVE_ONLY: "遗漏票据补录",
};

function formatFileSize(size: number | null): string {
  if (size == null) return "未知大小";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function FilterSelect({
  value,
  onChange,
  label,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 rounded-md border border-gray-200 bg-white px-2.5 text-sm text-gray-700 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
    >
      {children}
    </select>
  );
}

export function ReceiptLibraryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [filters, setFilters] = useState<ReceiptFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  const params = useMemo(() => {
    const query = new URLSearchParams({ page: String(page), pageSize: "12" });
    Object.entries(filters).forEach(([key, value]) => {
      if (value.trim()) query.set(key, value.trim());
    });
    return query.toString();
  }, [filters, page]);

  const { data, isLoading, isError, error } = useQuery<ReceiptResponse>({
    queryKey: ["reagent-receipts", params],
    enabled: open,
    queryFn: async () => {
      const response = await authFetch(`/api/documents/receipts?${params}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "票据加载失败" }));
        throw new Error(body.error || "票据加载失败");
      }
      return response.json();
    },
  });

  useEffect(() => {
    if (!open) {
      setSelectedIds(new Set());
      setDownloadError("");
    }
  }, [open]);

  const updateFilter = (key: keyof ReceiptFilters, value: string) => {
    setFilters((previous) => ({ ...previous, [key]: value }));
    setPage(1);
    setSelectedIds(new Set());
  };

  const downloadableOnPage = data?.data.filter((receipt) => receipt.hasOriginal) ?? [];
  const allPageSelected = downloadableOnPage.length > 0 && downloadableOnPage.every((receipt) => selectedIds.has(receipt.id));

  const togglePage = () => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (allPageSelected) downloadableOnPage.forEach((receipt) => next.delete(receipt.id));
      else downloadableOnPage.forEach((receipt) => next.add(receipt.id));
      return next;
    });
  };

  const toggleReceipt = (id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resetFilters = () => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
    setSelectedIds(new Set());
  };

  const handleBatchDownload = async () => {
    if (selectedIds.size === 0) return;
    setDownloading(true);
    setDownloadError("");
    try {
      const response = await authFetch("/api/documents/receipts/download", {
        method: "POST",
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "下载失败" }));
        throw new Error(body.error || "下载失败");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `试剂票据_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (downloadFailure) {
      setDownloadError(downloadFailure instanceof Error ? downloadFailure.message : "下载失败");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={<span className="flex items-center gap-2"><ReceiptText className="size-5 text-cyan-600" />试剂票据库</span>}
      width={1160}
      footer={null}
    >
      <div className="space-y-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={filters.query}
                onChange={(event) => updateFilter("query", event.target.value)}
                placeholder="试剂名称、CAS、品牌或文件名"
                className="h-9 bg-white pl-9"
              />
            </div>
            <FilterSelect label="上传人员" value={filters.uploadedById} onChange={(value) => updateFilter("uploadedById", value)}>
              <option value="">全部上传人员</option>
              {(data?.filterOptions.uploaders ?? []).map((uploader) => <option key={uploader.id} value={uploader.id}>{uploader.name || uploader.email}</option>)}
            </FilterSelect>
            <FilterSelect label="风险等级" value={filters.riskLevel} onChange={(value) => updateFilter("riskLevel", value)}>
              <option value="">全部风险</option><option value="LOW">低风险</option><option value="HIGH">高风险</option>
            </FilterSelect>
            <FilterSelect label="危化属性" value={filters.isHazardous} onChange={(value) => updateFilter("isHazardous", value)}>
              <option value="">全部危化属性</option><option value="true">危化品</option><option value="false">非危化品</option>
            </FilterSelect>
            <FilterSelect label="管制属性" value={filters.isControlled} onChange={(value) => updateFilter("isControlled", value)}>
              <option value="">全部管制属性</option><option value="true">管制品</option><option value="false">非管制品</option>
            </FilterSelect>
            <FilterSelect label="处理状态" value={filters.status} onChange={(value) => updateFilter("status", value)}>
              <option value="">全部状态</option><option value="PENDING">待确认</option><option value="CONFIRMED">已入库</option><option value="SKIPPED">不入库</option><option value="REJECTED">识别失败</option>
            </FilterSelect>
            <FilterSelect label="入库方式" value={filters.processingMode} onChange={(value) => updateFilter("processingMode", value)}>
              <option value="">全部入库方式</option><option value="OCR">OCR 智能入库</option><option value="MANUAL_ARCHIVE">手工票据入库</option><option value="ARCHIVE_ONLY">遗漏票据补录</option>
            </FilterSelect>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">上传日期</span>
            <Input aria-label="上传开始日期" type="date" value={filters.startDate} onChange={(event) => updateFilter("startDate", event.target.value)} className="h-9 w-40 bg-white" />
            <span className="text-xs text-slate-400">至</span>
            <Input aria-label="上传结束日期" type="date" value={filters.endDate} onChange={(event) => updateFilter("endDate", event.target.value)} className="h-9 w-40 bg-white" />
            <Button variant="ghost" size="sm" onClick={resetFilters} disabled={Object.values(filters).every((value) => !value)}>
              <X className="size-4" />清空筛选
            </Button>
            <div className="flex-1" />
            <span className="text-xs text-slate-500">共 {data?.pagination.total ?? 0} 张</span>
            <Button size="sm" onClick={handleBatchDownload} disabled={selectedIds.size === 0 || downloading} className="bg-cyan-600 hover:bg-cyan-700">
              {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              下载已选（{selectedIds.size}）
            </Button>
          </div>
          {downloadError && <p className="mt-2 text-sm text-red-600">{downloadError}</p>}
        </div>

        <div className="max-h-[56vh] overflow-auto rounded-xl border border-slate-200">
          {isLoading ? (
            <div className="flex min-h-72 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="size-5 animate-spin" />正在加载票据…</div>
          ) : isError ? (
            <div className="flex min-h-72 items-center justify-center text-sm text-red-600">{error instanceof Error ? error.message : "票据加载失败"}</div>
          ) : !data?.data.length ? (
            <div className="flex min-h-72 flex-col items-center justify-center gap-2 text-slate-400"><ReceiptText className="size-10" /><span className="text-sm">没有符合条件的票据</span></div>
          ) : (
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-xs text-slate-500 shadow-[0_1px_0_#e2e8f0]">
                <tr>
                  <th className="w-11 px-3 py-3"><input aria-label="选择本页票据" type="checkbox" checked={allPageSelected} onChange={togglePage} disabled={!downloadableOnPage.length} /></th>
                  <th className="px-3 py-3 font-medium">原始票据</th><th className="px-3 py-3 font-medium">试剂信息</th><th className="px-3 py-3 font-medium">属性</th><th className="px-3 py-3 font-medium">上传信息</th><th className="px-3 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.data.map((receipt) => {
                  const fileUrl = `/api/documents/receipts/${receipt.id}/file`;
                  const isImage = receipt.mimeType?.startsWith("image/");
                  return (
                    <tr key={receipt.id} className={cn("transition hover:bg-cyan-50/30", selectedIds.has(receipt.id) && "bg-cyan-50/60")}>
                      <td className="px-3 py-3 align-middle"><input aria-label={`选择票据 ${receipt.fileName}`} type="checkbox" checked={selectedIds.has(receipt.id)} onChange={() => toggleReceipt(receipt.id)} disabled={!receipt.hasOriginal} /></td>
                      <td className="px-3 py-3">
                        <div className="flex max-w-64 items-center gap-3">
                          <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white">
                            {receipt.hasOriginal && isImage ? <img src={fileUrl} alt={receipt.fileName} className="size-full object-cover" loading="lazy" /> : <FileText className={cn("size-6", receipt.hasOriginal ? "text-cyan-600" : "text-slate-300")} />}
                          </div>
                          <div className="min-w-0"><p className="truncate font-medium text-slate-800" title={receipt.fileName}>{receipt.fileName}</p><p className="mt-0.5 text-xs text-slate-400">{formatFileSize(receipt.fileSize)}{!receipt.hasOriginal && " · 历史记录无原件"}</p></div>
                        </div>
                      </td>
                      <td className="px-3 py-3"><p className="font-medium text-slate-800">{receipt.reagentName || "未识别"}</p><p className="mt-0.5 text-xs text-slate-500">{[receipt.casNumber, receipt.brand].filter(Boolean).join(" · ") || "暂无 CAS / 品牌"}</p></td>
                      <td className="px-3 py-3"><div className="flex max-w-52 flex-wrap gap-1">{receipt.riskLevel && <Badge variant="outline">{receipt.riskLevel === "HIGH" ? "高风险" : "低风险"}</Badge>}{receipt.isHazardous && <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">危化品</Badge>}{receipt.isControlled && <Badge className="bg-red-100 text-red-700 hover:bg-red-100">管制品</Badge>}<Badge variant="outline">{STATUS_LABELS[receipt.status] || receipt.status}</Badge><Badge className="bg-violet-50 text-violet-700 hover:bg-violet-50">{MODE_LABELS[receipt.processingMode] || receipt.processingMode}</Badge></div></td>
                      <td className="px-3 py-3"><p className="text-slate-700">{receipt.uploadedBy.name || receipt.uploadedBy.email}</p><p className="mt-0.5 text-xs text-slate-400">上传：{new Date(receipt.createdAt).toLocaleString("zh-CN", { hour12: false })}</p>{receipt.receiptDate && <p className="mt-0.5 text-xs text-slate-400">票据：{new Date(receipt.receiptDate).toLocaleDateString("zh-CN")}</p>}</td>
                      <td className="px-3 py-3 text-right"><Button variant="outline" size="sm" disabled={!receipt.hasOriginal} onClick={() => window.open(fileUrl, "_blank", "noopener,noreferrer")}><ExternalLink className="size-4" />查看</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <Pagination page={data?.pagination.page ?? page} totalPages={data?.pagination.totalPages ?? 0} onPageChange={(nextPage) => { setPage(nextPage); setSelectedIds(new Set()); }} />
      </div>
    </Dialog>
  );
}
