"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  Pencil,
  Save,
  AlertCircle,
  ScanText,
  ChevronDown,
  ChevronRight,
  FileSearch,
  PencilLine,
  Camera,
  ArrowLeft,
  MapPin,
  ArchiveRestore,
  ReceiptText,
  XCircle,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  RotateCw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { REAGENT_FIELDS } from "@/lib/ai/schema";
import type { StructuredResult } from "@/lib/ai/llm";
import type { ReagentFieldKey } from "@/lib/ai/schema";
import { authFetch } from "@/lib/auth-fetch";
import { isValidCasNumber } from "@/lib/cas-number";
import { useAuthStore } from "@/store/auth-store";
import { cn } from "@/lib/utils";
import { sanitizeHtml } from "@/lib/sanitize";
import { stripOcrImages } from "@/lib/receipt-ocr";
import { computeTotalCapacity, formatAmount, parseSpecification } from "@/lib/reagent-units";

interface FileRecognition {
  fileName: string;
  category: string;
  documentId: string;
  itemIndex: number;
  compoundCount: number;
  llmDeclaredCompoundCount: number;
  originalFileUrl: string;
  mimeType: string | null;
  structuredResult: StructuredResult;
  editing: boolean;
  editedFields: Record<string, string>;
  ocrMarkdown: string; // PaddleOCR 返回的原始 markdown（可视化用）
  showOcrRaw: boolean; // 是否展开 OCR 原文
  showLlmStatus: boolean; // 是否展开 LLM 状态
}

interface OcrJobSummary { queued: number; processing: number; failed: number; pendingItems: number }

interface OcrJobResponse {
  jobs: Array<{
    documentId: string;
    fileName: string;
    mimeType: string | null;
    status: string;
    originalFileUrl: string;
    ocrText: string;
    compoundCount: number;
    llmDeclaredCompoundCount: number;
    items: Array<StructuredResult & { confirmationStatus: string }>;
  }>;
  summary: OcrJobSummary;
}

type PageState = "idle" | "uploading" | "recognizing" | "reviewing" | "confirming" | "success";

interface UploadError {
  message: string;
  hint?: string;
  actionUrl?: string;
  actionText?: string;
}

function recognitionRequiredIssues(result: StructuredResult): string[] {
  const issues: string[] = [];
  if (!result.reagentName?.trim()) issues.push('试剂名称');
  if (!result.specification?.trim()) issues.push('每瓶/每件规格');
  else if (!parseSpecification(result.specification)) issues.push('可计算规格（如 500mL/瓶、100g/瓶、10mg/支）');
  if (!result.storageLocation?.trim()) issues.push('存储位置');
  if (result.casNumber?.trim() && !isValidCasNumber(result.casNumber)) {
    issues.push('有效 CAS 号（当前校验位不正确）');
  }
  const quantity = Number(result.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) issues.push('入库数量（至少 1 瓶/件）');
  if (!['LOW', 'HIGH'].includes(result.riskLevel)) issues.push('风险等级');
  return issues;
}

function inventoryPreview(result: StructuredResult): string | null {
  const specification = parseSpecification(result.specification);
  const quantity = Number(result.quantity);
  if (!specification || !Number.isInteger(quantity) || quantity < 1) return null;
  const total = computeTotalCapacity({
    stockQuantity: quantity,
    unit: '瓶',
    capacityPerUnit: specification.capacityPerUnit,
    capacityUnit: specification.capacityUnit,
  });
  if (!total) return null;
  return `${quantity} 瓶/件 × ${formatAmount(specification.capacityPerUnit, specification.capacityUnit)} = ${formatAmount(total.total, total.unit)}`;
}

export function ReagentStockInContent({
  initialMode = 'photo',
  initialReview = false,
  embedded = false,
  onCompleted,
}: {
  initialMode?: 'photo' | 'manual' | 'archive';
  initialReview?: boolean;
  embedded?: boolean;
  onCompleted?: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'photo' | 'manual' | 'archive'>(initialMode);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pageState, setPageState] = useState<PageState>("idle");
  const [progress, setProgress] = useState(0);
  const [recognitions, setRecognitions] = useState<FileRecognition[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<UploadError | null>(null);
  const [queueSummary, setQueueSummary] = useState<OcrJobSummary | null>(null);
  const [queueMessage, setQueueMessage] = useState('');
  const [confirmingItem, setConfirmingItem] = useState<string | null>(null);
  const [skippingItem, setSkippingItem] = useState<string | null>(null);
  const [imageViewer, setImageViewer] = useState<{ url: string; name: string } | null>(null);
  const [imageRotation, setImageRotation] = useState(0);
  const [imageScale, setImageScale] = useState(1);

  const openImageViewer = useCallback((recognition: FileRecognition) => {
    setImageRotation(0);
    setImageScale(1);
    setImageViewer({ url: recognition.originalFileUrl, name: recognition.fileName });
  }, []);

  const closeImageViewer = useCallback(() => {
    setImageViewer(null);
    setImageRotation(0);
    setImageScale(1);
  }, []);

  const loadOcrJobs = useCallback(async (openReview = false) => {
    try {
      const response = await authFetch('/api/documents/ocr-jobs');
      if (!response.ok) return;
      const data = await response.json() as OcrJobResponse;
      setQueueSummary(data.summary);
      if (!openReview) return;
      const pending = data.jobs
        .flatMap((job) => job.items.map((item, itemIndex) => ({ job, item, itemIndex })))
        .filter(({ item }) => item.confirmationStatus === 'PENDING')
        .map(({ job, item, itemIndex }): FileRecognition => ({
          fileName: job.fileName,
          category: 'DOCUMENT',
          documentId: job.documentId,
          itemIndex,
          compoundCount: job.compoundCount,
          llmDeclaredCompoundCount: job.llmDeclaredCompoundCount,
          originalFileUrl: job.originalFileUrl,
          mimeType: job.mimeType,
          structuredResult: item,
          editing: recognitionRequiredIssues(item).length > 0,
          editedFields: Object.fromEntries(REAGENT_FIELDS.map((field) => [field.key, String(item[field.key as keyof StructuredResult] ?? '')])),
          ocrMarkdown: job.ocrText || '',
          showOcrRaw: false,
          showLlmStatus: false,
        }));
      setRecognitions(pending);
      setPageState(pending.length ? 'reviewing' : 'idle');
      if (!pending.length && data.summary.queued + data.summary.processing > 0) {
        setQueueMessage('票据仍在后台识别，完成后会出现在待确认列表。');
      }
    } catch {
      // 状态轮询失败不阻断上传和核对。
    }
  }, []);

  useEffect(() => {
    void loadOcrJobs(initialReview);
    const timer = window.setInterval(() => void loadOcrJobs(false), 5000);
    return () => window.clearInterval(timer);
  }, [initialReview, loadOcrJobs]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setPageState("uploading");
    setProgress(10);
    try {
      const formData = new FormData();
      Array.from(files).forEach((file) => { formData.append("files", file); });
      formData.append("type", "STOCK_IN");
      setProgress(60);
      const res = await authFetch("/api/documents/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "上传失败" }));
        throw new Error(err.error || `上传失败（${res.status}）`);
      }
      const data = await res.json() as { jobs?: Array<{ documentId: string }>; message?: string };
      setProgress(100);
      const uploadedCount = data.jobs?.length || 0;
      setQueueMessage(data.message || `已加入后台识别队列，共 ${uploadedCount} 张票据`);
      toast.success(`已上传 ${uploadedCount} 张票据，OCR 与 LLM 正在后台运行。完成后请进入入库审核逐条确认。`, {
        duration: 12_000,
        action: {
          label: '进入入库审核',
          onClick: () => void loadOcrJobs(true),
        },
      });
      setPageState("idle");
      setProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await loadOcrJobs(false);
    } catch (error) {
      console.error("上传识别失败:", error);
      const errMsg = error instanceof Error ? error.message : "上传识别失败";
      // 检测常见错误类型，给出友好提示
      const parsed = parseUploadError(errMsg);
      setUploadError(parsed);
      setPageState("idle"); setProgress(0);
    }
  }, [loadOcrJobs]);

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); if (!dragOver) setDragOver(true); }, [dragOver]);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files); }, [handleFiles]);

  const toggleEdit = useCallback((index: number) => {
    setRecognitions((prev) => prev.map((r, i) => i === index ? { ...r, editing: !r.editing, editedFields: !r.editing ? Object.fromEntries(REAGENT_FIELDS.map((f) => [f.key, String(r.structuredResult[f.key as keyof StructuredResult] ?? "")])) : r.editedFields } : r));
  }, []);

  const toggleOcrRaw = useCallback((index: number) => {
    setRecognitions((prev) => prev.map((r, i) => i === index ? { ...r, showOcrRaw: !r.showOcrRaw } : r));
  }, []);

  const toggleLlmStatus = useCallback((index: number) => {
    setRecognitions((prev) => prev.map((r, i) => i === index ? { ...r, showLlmStatus: !r.showLlmStatus } : r));
  }, []);

  const updateField = useCallback((index: number, key: ReagentFieldKey, value: string) => {
    setRecognitions((prev) => prev.map((r, i) => i === index ? { ...r, editedFields: { ...r.editedFields, [key]: value } } : r));
  }, []);

  const saveEdit = useCallback((index: number) => {
    setRecognitions((prev) => prev.map((r, i) => {
      if (i !== index) return r;
      const merged = Object.fromEntries(REAGENT_FIELDS.map((f) => {
        const v = r.editedFields[f.key] ?? "";
        if (f.key === "quantity") return [f.key, parseInt(v || "1", 10)];
        if (f.key === "isHazardous" || f.key === "isControlled") return [f.key, v === "true"];
        return [f.key, v];
      }));
      return { ...r, structuredResult: { ...r.structuredResult, ...merged } as StructuredResult, editing: false };
    }));
  }, []);

  const confirmRecognition = useCallback(async (rec: FileRecognition) => {
    const itemKey = `${rec.documentId}:${rec.itemIndex}`;
    setConfirmingItem(itemKey);
    try {
      const fields = rec.editing ? rec.editedFields : rec.structuredResult;
      const value = (key: keyof StructuredResult) => String(fields[key] ?? '').trim();
      const name = value('reagentName');
      const specification = value('specification');
      const storageLocation = value('storageLocation');
      const stockQuantity = parseInt(value('quantity') || '1', 10);
      const riskLevel = value('riskLevel').toUpperCase();
      if (!name) throw new Error('试剂名称不能为空，请编辑后重试');
      if (!specification) throw new Error(`试剂「${name}」的规格不能为空`);
      if (!storageLocation) throw new Error(`试剂「${name}」的储存位置不能为空`);
      if (!Number.isInteger(stockQuantity) || stockQuantity < 1) throw new Error(`试剂「${name}」的入库数量必须至少为 1 瓶/件`);
      if (!parseSpecification(specification)) throw new Error(`试剂「${name}」的规格必须包含可计算的数字和单位，例如 500mL/瓶、100g/瓶或 10mg/支`);
      if (!['LOW', 'HIGH'].includes(riskLevel)) throw new Error(`试剂「${name}」的风险等级无效`);

      const response = await authFetch(`/api/documents/${rec.documentId}/confirm`, {
        method: 'PATCH',
        body: JSON.stringify({
          itemIndex: rec.itemIndex,
          action: 'CONFIRM',
          reagent: {
            name,
            casNumber: value('casNumber'),
            specification,
            remarks: value('remarks'),
            brand: value('brand'),
            dangerCategory: value('dangerCategory'),
            riskLevel,
            isHazardous: fields.isHazardous === true || String(fields.isHazardous) === 'true',
            isControlled: fields.isControlled === true || String(fields.isControlled) === 'true',
            storageLocation,
            stockQuantity,
            unit: '瓶',
            batchNumber: value('batchNumber'),
          },
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `试剂「${name}」入库失败`);
      setRecognitions((previous) => previous.filter((item) => `${item.documentId}:${item.itemIndex}` !== itemKey));
      setQueueSummary((previous) => previous ? { ...previous, pendingItems: Math.max(0, previous.pendingItems - 1) } : previous);
      setQueueMessage(body.message || `「${name}」已确认入库。可继续核对下一条或返回上传新票据。`);
      if (recognitions.length === 1) {
        setPageState('idle');
        onCompleted?.();
      }
    } catch (error) {
      console.error("确认入库失败:", error);
      alert(error instanceof Error ? error.message : "确认入库失败，请重试");
    } finally {
      setConfirmingItem(null);
    }
  }, [recognitions.length, onCompleted]);

  const skipRecognition = useCallback(async (rec: FileRecognition) => {
    const itemKey = `${rec.documentId}:${rec.itemIndex}`;
    const displayName = rec.structuredResult.reagentName || rec.structuredResult.casNumber || `第 ${rec.itemIndex + 1} 条`;
    if (!window.confirm(`确定将「${displayName}」标记为不入库吗？该操作不会创建试剂或库存流水。`)) return;
    setSkippingItem(itemKey);
    try {
      const response = await authFetch(`/api/documents/${rec.documentId}/confirm`, {
        method: 'PATCH',
        body: JSON.stringify({ itemIndex: rec.itemIndex, action: 'SKIP' }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '选择不入库失败');
      setRecognitions((previous) => previous.filter((item) => `${item.documentId}:${item.itemIndex}` !== itemKey));
      setQueueSummary((previous) => previous ? { ...previous, pendingItems: Math.max(0, previous.pendingItems - 1) } : previous);
      setQueueMessage(body.message || `「${displayName}」已选择不入库。`);
      if (recognitions.length === 1) {
        setPageState('idle');
        onCompleted?.();
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : '选择不入库失败，请重试');
    } finally {
      setSkippingItem(null);
    }
  }, [recognitions.length, onCompleted]);

  const handleReset = useCallback(() => { setRecognitions([]); setProgress(0); setPageState("idle"); setUploadError(null); }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* 返回试剂库总览 */}
      {!embedded && <Link href="/user/alerts" className="inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700">
        <ArrowLeft className="size-4" />
        返回试剂库总览
      </Link>}

      {mode === 'photo' && (queueMessage || queueSummary) && (
        <Card className="border-sky-200 bg-sky-50/70">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <div className="flex size-10 items-center justify-center rounded-xl bg-sky-600 text-white">
              {(queueSummary?.queued || queueSummary?.processing) ? <Loader2 className="size-5 animate-spin" /> : <CheckCircle2 className="size-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800">{queueMessage || 'OCR 任务状态'}</p>
              <p className="mt-1 text-xs text-slate-500">
                排队 {queueSummary?.queued || 0} · 识别中 {queueSummary?.processing || 0} · 待确认 {queueSummary?.pendingItems || 0}
                {(queueSummary?.failed || 0) > 0 ? ` · 失败 ${queueSummary?.failed}` : ''}
              </p>
            </div>
            {(queueSummary?.pendingItems || 0) > 0 && (
              <Button type="button" variant="outline" onClick={() => void loadOcrJobs(true)}>逐条核对</Button>
            )}
            {!embedded && <Link href="/user"><Button type="button" variant="outline">返回首页</Button></Link>}
          </CardContent>
        </Card>
      )}

      {/* 模式切换（仅 idle 状态显示）*/}
      {pageState === "idle" && (
        <div className="grid gap-3 md:grid-cols-3">
          <button
            type="button"
            onClick={() => setMode('photo')}
            className={cn(
              'flex items-center gap-3 rounded-xl border-2 p-4 text-left transition-all',
              mode === 'photo' ? 'border-sky-500 bg-sky-50 shadow-sm' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
            )}
          >
            <div className={cn('flex size-10 items-center justify-center rounded-lg transition-colors', mode === 'photo' ? 'bg-sky-500 text-white' : 'bg-gray-100 text-gray-500')}>
              <Camera className="size-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-900">智能票据入库</div>
              <div className="text-xs text-gray-500">保存原图 · OCR + AI 识别</div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setMode('manual')}
            className={cn(
              'flex items-center gap-3 rounded-xl border-2 p-4 text-left transition-all',
              mode === 'manual' ? 'border-emerald-500 bg-emerald-50 shadow-sm' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
            )}
          >
            <div className={cn('flex size-10 items-center justify-center rounded-lg transition-colors', mode === 'manual' ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-500')}>
              <PencilLine className="size-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-900">手工票据入库</div>
              <div className="text-xs text-gray-500">填写信息 · 票据不做 OCR</div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setMode('archive')}
            className={cn(
              'flex items-center gap-3 rounded-xl border-2 p-4 text-left transition-all',
              mode === 'archive' ? 'border-violet-500 bg-violet-50 shadow-sm' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
            )}
          >
            <div className={cn('flex size-10 items-center justify-center rounded-lg transition-colors', mode === 'archive' ? 'bg-violet-500 text-white' : 'bg-gray-100 text-gray-500')}>
              <ArchiveRestore className="size-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-900">补录遗漏票据</div>
              <div className="text-xs text-gray-500">只归档原图 · 不改变库存</div>
            </div>
          </button>
        </div>
      )}

      {/* 手动填写入库表单 */}
      {mode === 'manual' && pageState === 'idle' && (
        <ManualEntryForm onSuccess={() => {
          setPageState('success');
          setTimeout(() => {
            if (onCompleted) onCompleted();
            else router.push('/user/alerts');
          }, 1500);
        }} />
      )}

      {mode === 'archive' && pageState === 'idle' && (
        <ReceiptArchiveForm onSuccess={() => {
          setPageState('success');
          setTimeout(() => {
            if (onCompleted) onCompleted();
            else router.push('/user/alerts');
          }, 1500);
        }} />
      )}

      {/* 拍照上传流程 */}
      {mode === 'photo' && (pageState === "idle" || pageState === "uploading" || pageState === "recognizing") && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileText className="size-5" />拍照上传</CardTitle>
            <CardDescription>上传后立即进入后台队列；LLM 会统计并结构化输出一张票据中的全部化合物，确认入库后才查询 PubChem</CardDescription>
          </CardHeader>
          <CardContent>
            {uploadError && (
              <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-amber-800">{uploadError.message}</p>
                    {uploadError.hint && (
                      <p className="mt-1 text-xs text-amber-700">{uploadError.hint}</p>
                    )}
                    {uploadError.actionUrl && uploadError.actionText && (
                      <button
                        onClick={() => router.push(uploadError.actionUrl!)}
                        className="mt-2 inline-flex items-center gap-1 rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700"
                      >
                        <ScanText className="size-3" />
                        {uploadError.actionText}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {pageState === "idle" ? (
              <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors ${dragOver ? "border-emerald-500 bg-emerald-50" : "border-gray-300 bg-gray-50 hover:border-emerald-400 hover:bg-emerald-50/50"}`}>
                <Upload className="mb-4 size-12 text-gray-400" />
                <p className="mb-1 text-base font-medium text-gray-700">拖拽文件到此处，或点击选择文件</p>
                <p className="text-sm text-gray-500">支持 JPG、PNG、WebP，可一次选择多张</p>
                <p className="mt-2 text-xs text-gray-400">
                  <ScanText className="mr-1 inline-block size-3 align-middle" />
                  拍照或单据均通过 PaddleOCR-VL 识别
                </p>
                <input ref={fileInputRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files && handleFiles(e.target.files)} />
              </div>
            ) : (
              <div className="space-y-4 py-8 text-center">
                <Loader2 className="mx-auto size-10 animate-spin text-emerald-600" />
                <p className="text-base font-medium text-gray-700">正在保存原图并加入 OCR 队列...</p>
                <div className="mx-auto max-w-xs"><Progress value={progress} className="h-2" /></div>
                <p className="text-xs text-gray-400">入队后可以立即返回或继续上传，无需停留等待</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {(pageState === "reviewing" || pageState === "confirming" || pageState === "success") && (
        <>
          {recognitions.map((rec, index) => (
            <Card key={`${rec.documentId}:${rec.itemIndex}`}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base"><FileText className="size-4" />{rec.fileName}<Badge variant="outline" className="text-xs">共识别 {rec.compoundCount} 条 · 当前第 {rec.itemIndex + 1} 条</Badge><Badge variant="outline" className="text-xs">置信度 {Math.round((rec.structuredResult.confidence ?? 0) * 100)}%</Badge><Badge className="bg-sky-100 text-sky-700 hover:bg-sky-100">确认后补全 PubChem</Badge></CardTitle>
                  <div className="flex gap-2">
                    {rec.editing ? (
                      <><Button variant="outline" size="sm" onClick={() => toggleEdit(index)}>取消</Button><Button size="sm" onClick={() => saveEdit(index)} className="bg-emerald-600 hover:bg-emerald-700"><Save className="size-3.5" />保存</Button></>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => toggleEdit(index)}><Pencil className="size-3.5" />编辑</Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-2 text-xs font-semibold text-slate-600">票据原图（请与右侧提取字段逐项核对）</p>
                  {rec.mimeType?.startsWith('image/') ? (
                    <button
                      type="button"
                      onClick={() => openImageViewer(rec)}
                      className="group relative block w-full cursor-zoom-in overflow-hidden rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                      aria-label={`放大查看并旋转 ${rec.fileName}`}
                    >
                      {/* 原图来自同源受认证接口，尺寸在上传时未知。 */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={rec.originalFileUrl} alt={`${rec.fileName} 原始票据`} className="max-h-[480px] w-full object-contain" />
                      <span className="absolute inset-0 flex items-center justify-center bg-slate-900/0 text-white opacity-0 transition group-hover:bg-slate-900/25 group-hover:opacity-100 group-focus:opacity-100">
                        <span className="flex items-center gap-2 rounded-full bg-slate-900/70 px-4 py-2 text-sm font-medium"><ZoomIn className="size-4" />点击放大</span>
                      </span>
                    </button>
                  ) : (
                    <a href={rec.originalFileUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-sky-700 underline">打开原始票据</a>
                  )}
                </div>
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                  LLM 声明识别 {rec.llmDeclaredCompoundCount} 个化合物，核对列表共 {rec.compoundCount} 条。分子式、分子量、SMILES 等只会在点击“确认入库”后按最终 CAS 查询 PubChem；风险字段仍须人工核对。
                </div>
                {recognitionRequiredIssues(rec.structuredResult).length > 0 && (
                  <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-700">
                    入库前必须补充或修正：{recognitionRequiredIssues(rec.structuredResult).join('、')}。缺失字段已自动进入编辑状态，保存后才能确认入库。
                  </div>
                )}
                {inventoryPreview(rec.structuredResult) && (
                  <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-800">
                    预计库存总量：{inventoryPreview(rec.structuredResult)}
                  </div>
                )}
                <div className="divide-y">
                  {REAGENT_FIELDS.map((field) => {
                    const value = rec.editing ? rec.editedFields[field.key] ?? "" : String(rec.structuredResult[field.key as keyof StructuredResult] ?? "");
                    return (
                      <div key={field.key} className="flex items-center gap-4 py-2.5">
                        <div className="w-28 shrink-0 text-sm font-medium text-gray-500">{field.label}{field.required && <span className="ml-0.5 text-red-500">*</span>}</div>
                        {rec.editing ? (
                          field.key === "riskLevel" ? (
                            <select
                              value={value}
                              onChange={(e) => updateField(index, field.key as ReagentFieldKey, e.target.value)}
                              className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            >
                              <option value="LOW">LOW（低风险）</option>
                              <option value="HIGH">HIGH（高风险）</option>
                            </select>
                          ) : field.key === "isHazardous" || field.key === "isControlled" ? (
                            <select
                              value={value}
                              onChange={(e) => updateField(index, field.key as ReagentFieldKey, e.target.value)}
                              className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            >
                              <option value="false">否</option>
                              <option value="true">是</option>
                            </select>
                          ) : (
                            <Input value={value} onChange={(e) => updateField(index, field.key as ReagentFieldKey, e.target.value)} className="flex-1" placeholder={`请输入${field.label}`} />
                          )
                        ) : (
                          <div className="flex-1 text-sm text-gray-900">
                            {field.key === "riskLevel" ? <Badge variant="outline" className={value === "HIGH" ? "border-red-500 text-red-600" : "border-green-500 text-green-600"}>{value === "HIGH" ? "高风险" : "低风险"}</Badge>
                              : field.key === "isHazardous" ? <Badge variant="outline" className={value === "true" ? "border-red-500 text-red-600" : "border-gray-300 text-gray-500"}>{value === "true" ? "是" : "否"}</Badge>
                              : field.key === "isControlled" ? <Badge variant="outline" className={value === "true" ? "border-purple-500 text-purple-600" : "border-gray-300 text-gray-500"}>{value === "true" ? "是" : "否"}</Badge>
                              : value || <span className="text-gray-400">未识别</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* OCR 识别原文可视化（参考 aistudio 任务详情页，渲染 HTML 表格） */}
                <div className="mt-4 border-t pt-3">
                  <button
                    type="button"
                    onClick={() => toggleOcrRaw(index)}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm text-gray-600 hover:bg-gray-50"
                  >
                    <span className="flex items-center gap-1.5 font-medium">
                      <FileSearch className="size-3.5" />
                      PaddleOCR 识别原文
                      <Badge variant="outline" className="ml-1 text-xs">
                        {rec.ocrMarkdown.length > 0 ? `${rec.ocrMarkdown.length} 字符` : "空"}
                      </Badge>
                    </span>
                    {rec.showOcrRaw ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  </button>
                  {rec.showOcrRaw && (
                    <div className="mt-2 rounded-md border bg-white p-3">
                      {rec.ocrMarkdown ? (
                        <div
                          className="ocr-markdown max-h-96 overflow-auto text-xs leading-5 text-gray-800"
                          dangerouslySetInnerHTML={{ __html: sanitizeHtml(renderMarkdownAsHtml(stripOcrImages(rec.ocrMarkdown))) }}
                        />
                      ) : (
                        <div className="flex items-start gap-2 text-xs text-amber-700">
                          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                          <div>
                            <p className="font-medium">PaddleOCR 未提取到任何文本</p>
                            <p className="mt-1 text-amber-600">
                              可能原因：1) OCR 返回结构未识别（查看 dev server 控制台日志）；2) 图片模糊或无文字；
                              3) PaddleOCR 服务异常。请在「API 配置」页确认 Token 有效。
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* LLM 调用状态诊断 */}
                <div className="mt-2 border-t pt-2">
                  <button
                    type="button"
                    onClick={() => toggleLlmStatus(index)}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm text-gray-600 hover:bg-gray-50"
                  >
                    <span className="flex items-center gap-1.5 font-medium">
                      <AlertCircle className="size-3.5" />
                      LLM 调用状态
                      <Badge
                        variant="outline"
                        className={
                          rec.structuredResult.llmStatus === 'ok'
                            ? 'text-xs text-green-600 border-green-500'
                            : rec.structuredResult.llmStatus === 'no_config'
                            ? 'text-xs text-amber-600 border-amber-500'
                            : 'text-xs text-red-600 border-red-500'
                        }
                      >
                        {rec.structuredResult.llmStatus === 'ok' ? '提取成功' : rec.structuredResult.llmStatus === 'no_config' ? '未配置 LLM' : rec.structuredResult.llmStatus === 'api_error' ? '调用失败' : rec.structuredResult.llmStatus === 'parse_error' ? '解析失败' : '降级正则'}
                      </Badge>
                    </span>
                    {rec.showLlmStatus ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  </button>
                  {rec.showLlmStatus && (
                    <div className="mt-2 rounded-md border bg-gray-50 p-3 text-xs">
                      {rec.structuredResult.llmError ? (
                        <p className="leading-5 text-gray-800">
                          <span className="font-medium">失败原因：</span>
                          {rec.structuredResult.llmError}
                        </p>
                      ) : rec.structuredResult.llmStatus === 'ok' ? (
                        <p className="text-green-700">LLM 已成功提取字段。若字段仍为空，说明 OCR 文本中确实没有对应信息。</p>
                      ) : (
                        <p className="text-gray-600">LLM 调用状态正常，无错误信息。</p>
                      )}
                      {rec.structuredResult.llmStatus === 'no_config' && (
                        <p className="mt-2 text-amber-700">
                          请在「API 配置」页面配置 LLM 凭证（个人或实验室级），否则系统无法从 OCR 文本中语义提取试剂信息，仅依赖正则降级（对表格/自由文本效果差）。
                        </p>
                      )}
                    </div>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap justify-end gap-2 border-t pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void skipRecognition(rec)}
                    disabled={Boolean(confirmingItem) || Boolean(skippingItem)}
                    title="跳过不需要填写或保存必填字段"
                    className="border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                  >
                    {skippingItem === `${rec.documentId}:${rec.itemIndex}` ? <><Loader2 className="size-4 animate-spin" />正在跳过...</> : <><XCircle className="size-4" />选择不入库</>}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void confirmRecognition(rec)}
                    disabled={rec.editing || recognitionRequiredIssues(rec.structuredResult).length > 0 || Boolean(confirmingItem) || Boolean(skippingItem)}
                    title={recognitionRequiredIssues(rec.structuredResult).length > 0 ? `请先补充：${recognitionRequiredIssues(rec.structuredResult).join('、')}` : undefined}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    {confirmingItem === `${rec.documentId}:${rec.itemIndex}` ? <><Loader2 className="size-4 animate-spin" />正在入库...</> : <><CheckCircle2 className="size-4" />确认此条入库</>}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={handleReset}>返回并继续上传</Button>
            {!embedded && <Link href="/user"><Button variant="outline">返回首页</Button></Link>}
          </div>
        </>
      )}

      <Dialog open={Boolean(imageViewer)} onOpenChange={(open) => { if (!open) closeImageViewer(); }}>
        <DialogContent className="flex max-h-[96vh] max-w-[96vw] flex-col overflow-hidden sm:max-w-6xl">
          <DialogHeader>
            <div className="flex items-center justify-between gap-4">
              <DialogTitle className="min-w-0 truncate">票据原图 · {imageViewer?.name}</DialogTitle>
              <Button type="button" variant="outline" size="sm" onClick={closeImageViewer} className="shrink-0">
                <X className="size-4" />退出
              </Button>
            </div>
          </DialogHeader>
          <div className="flex flex-wrap items-center justify-center gap-2 border-y border-slate-200 py-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setImageScale((value) => Math.max(0.5, value - 0.25))}
              disabled={imageScale <= 0.5}
            >
              <ZoomOut className="size-4" />缩小
            </Button>
            <Badge variant="outline">{Math.round(imageScale * 100)}%</Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setImageScale((value) => Math.min(3, value + 0.25))}
              disabled={imageScale >= 3}
            >
              <ZoomIn className="size-4" />放大
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setImageScale(1)} disabled={imageScale === 1}>
              恢复 100%
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setImageRotation((value) => value - 90)}>
              <RotateCcw className="size-4" />向左旋转
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setImageRotation(0)} disabled={imageRotation === 0}>
              恢复原角度
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setImageRotation((value) => value + 90)}>
              <RotateCw className="size-4" />向右旋转
            </Button>
            <Badge variant="outline">{((imageRotation % 360) + 360) % 360}°</Badge>
          </div>
          <div className="min-h-[55vh] flex-1 overflow-auto rounded-lg bg-slate-100 p-6">
            {imageViewer && (
              <div className="flex min-h-[55vh] min-w-full items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageViewer.url}
                  alt={`${imageViewer.name} 放大票据`}
                  className="h-auto max-w-none object-contain shadow-lg transition-[width,transform] duration-200"
                  style={{
                    width: `${imageScale * 100}%`,
                    transform: `rotate(${imageRotation}deg)`,
                    transformOrigin: 'center',
                  }}
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * 解析上传/OCR 错误，生成友好的提示信息与跳转动作
 */
function parseUploadError(message: string): UploadError {
  const msg = message.toLowerCase();

  // LLM 未接入
  if (message.includes('LLM 未接入') || message.includes('LLM API 凭证')) {
    return {
      message: 'LLM 未接入',
      hint: '系统未配置 LLM API 凭证。OCR 识别后的字段提取必须依赖 LLM 语义理解，请前往「API 配置」配置 LLM（个人或实验室级）后再上传。',
      actionUrl: '/user/api-config',
      actionText: '前往配置 LLM',
    };
  }

  // 未配置 OCR Token
  if (message.includes('PaddleOCR API Token') || message.includes('未配置') || message.includes('尚未配置')) {
    return {
      message: '尚未配置 OCR API Token',
      hint: '请在「API 配置」页面填写 PaddleOCR API Token；若个人未配置，可联系管理员配置实验室统一 Token。',
      actionUrl: '/user/api-config',
      actionText: '前往 API 配置',
    };
  }

  // 网络错误
  if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('fetch') || msg.includes('连接')) {
    return {
      message: '网络连接异常',
      hint: '无法连接到 OCR 服务，请检查网络后重试。若问题持续，可能是 OCR 服务暂时不可用。',
    };
  }

  // 超时
  if (msg.includes('超时') || msg.includes('timeout') || msg.includes('timed out')) {
    return {
      message: 'OCR 识别超时',
      hint: '图片可能过大或服务繁忙，请稍后重试，或换用更清晰的图片。',
    };
  }

  // Token 无效
  if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('无效') || msg.includes('过期')) {
    return {
      message: 'OCR Token 无效或已过期',
      hint: '请前往「API 配置」页面更新 PaddleOCR API Token。',
      actionUrl: '/user/api-config',
      actionText: '前往更新 Token',
    };
  }

  // 文件大小/格式
  if (msg.includes('10mb') || msg.includes('大小')) {
    return {
      message: '文件大小超限',
      hint: '图片大小不能超过 10MB，请压缩后重试。',
    };
  }
  if (msg.includes('类型') || msg.includes('格式')) {
    return {
      message: '文件格式不支持',
      hint: '仅支持 JPG/PNG/WebP 图片与 PDF 文件。',
    };
  }

  // 默认错误
  return {
    message: '上传识别失败',
    hint: message,
  };
}

/**
 * 将 PaddleOCR 返回的 markdown 文本渲染为 HTML
 * - 保留已有 HTML 标签（<table>, <img>, <div> 等）直接渲染
 * - 转换 markdown 标题（# ## ###）为 <h1>/<h2>/<h3>
 * - 转换 markdown 列表项（- 或 *）为 <li>
 * - XSS 防护：最终输出在渲染处经 sanitizeHtml（DOMPurify）净化，此处仅做格式转换
 */
function renderMarkdownAsHtml(markdown: string): string {
  if (!markdown) return '';

  let html = markdown;

  // 1. markdown 标题转换（行首 #，不在 HTML 标签内）
  //    注意：PaddleOCR 返回的 markdown 中 # 标题通常独立成行
  html = html.replace(/^###\s+(.+)$/gm, '<h3 class="text-sm font-semibold mt-3 mb-1">$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2 class="text-base font-semibold mt-3 mb-1">$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1 class="text-lg font-bold mt-3 mb-2">$1</h1>');

  // 2. markdown 列表项（行首 - 或 *，不在 HTML 表格内）
  html = html.replace(/^[\-\*]\s+(.+)$/gm, '<li class="ml-4 list-disc">$1</li>');

  return html;
}

/**
 * 手动填写入库表单
 * - 字段对齐 REAGENT_FIELDS + createReagentSchema
 * - 提交成功后调用 onSuccess
 */
interface ManualEntryFormProps {
  onSuccess: () => void;
}

interface ManualFormState {
  name: string;
  casNumber: string;
  specification: string;
  brand: string;
  dangerCategory: string;
  riskLevel: 'LOW' | 'HIGH';
  isHazardous: boolean;
  isControlled: boolean;
  storageLocation: string;
  stockQuantity: string;
  unit: string;
  batchNumber: string;
  expiryDate: string;
}

const INITIAL_FORM: ManualFormState = {
  name: '',
  casNumber: '',
  specification: '',
  brand: '',
  dangerCategory: '',
  riskLevel: 'LOW',
  isHazardous: false,
  isControlled: false,
  storageLocation: '',
  stockQuantity: '1',
  unit: '瓶',
  batchNumber: '',
  expiryDate: '',
};

function ManualEntryForm({ onSuccess }: ManualEntryFormProps) {
  const [form, setForm] = useState<ManualFormState>(INITIAL_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  // 上次储存位置（自动查询同名/同CAS试剂）
  const [lastLocation, setLastLocation] = useState<string | null>(null);
  const [locationAutoFilled, setLocationAutoFilled] = useState(false);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [noReceipt, setNoReceipt] = useState(false);
  const [noReceiptReason, setNoReceiptReason] = useState('');
  const receiptInputRef = useRef<HTMLInputElement>(null);

  const update = <K extends keyof ManualFormState>(key: K, value: ManualFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
    // 用户手动编辑储存位置时，清除自动填入标记
    if (key === 'storageLocation') {
      setLocationAutoFilled(false);
    }
  };

  // 查询同名/同CAS试剂的上次储存位置（debounce 500ms）
  // 若查到则自动填入，用户可修改；修改后不再自动覆盖
  useEffect(() => {
    const name = form.name.trim();
    const cas = form.casNumber.trim();
    if (!name && !cas) {
      setLastLocation(null);
      setLocationAutoFilled(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (name) params.set('name', name);
        if (cas) params.set('casNumber', cas);
        const res = await authFetch(`/api/reagents/lookup?${params.toString()}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.lastStorageLocation) {
          setLastLocation(data.lastStorageLocation);
          // 仅当用户未填写储存位置时自动填入
          setForm((prev) => prev.storageLocation ? prev : { ...prev, storageLocation: data.lastStorageLocation });
          setLocationAutoFilled(true);
        } else {
          setLastLocation(null);
          setLocationAutoFilled(false);
        }
      } catch {
        // 查询失败不阻断表单
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [form.name, form.casNumber]);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = '试剂名称不能为空';
    if (!form.specification.trim()) e.specification = '规格不能为空（如 500mL、10mg）';
    if (!form.storageLocation.trim()) e.storageLocation = '储存位置不能为空（如 酸碱柜 A-1）';
    const qty = Number(form.stockQuantity);
    if (!form.stockQuantity.trim() || !Number.isInteger(qty) || qty < 0) e.stockQuantity = '数量必须为非负整数';
    if (!form.unit.trim()) e.unit = '单位不能为空';
    if (!noReceipt && !receipt) e.receipt = '采购入库必须上传原始票据';
    if (noReceipt && noReceiptReason.trim().length < 4) e.noReceiptReason = '请填写至少 4 个字的无票据原因';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const labId = useAuthStore.getState().user?.labId;
      if (!labId) {
        alert('无法获取实验室信息，请重新登录');
        setSubmitting(false);
        return;
      }
      const payload = {
        name: form.name.trim(),
        casNumber: form.casNumber.trim(),
        specification: form.specification.trim(),
        brand: form.brand.trim(),
        dangerCategory: form.dangerCategory.trim(),
        riskLevel: form.riskLevel,
        isHazardous: form.isHazardous,
        isControlled: form.isControlled,
        storageLocation: form.storageLocation.trim(),
        stockQuantity: Number(form.stockQuantity),
        minStock: 0,
        unit: form.unit.trim(),
        batchNumber: form.batchNumber.trim(),
        expiryDate: form.expiryDate || null,
        labId,
      };
      const requestData = new FormData();
      requestData.set('reagent', JSON.stringify(payload));
      requestData.set('noReceipt', String(noReceipt));
      requestData.set('noReceiptReason', noReceiptReason.trim());
      requestData.set('receiptDate', receiptDate);
      if (receipt) requestData.set('receipt', receipt);
      const res = await authFetch('/api/stock-ins/manual', {
        method: 'POST',
        body: requestData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '入库失败' }));
        if (err.details && typeof err.details === 'object') {
          setErrors(Object.fromEntries(Object.entries(err.details).filter(([, messages]) => Array.isArray(messages)).map(([field, messages]) => [field, (messages as string[]).join('；')])));
        }
        throw new Error(err.error || `入库失败 (${res.status})`);
      }
      setForm(INITIAL_FORM);
      setReceipt(null);
      setNoReceipt(false);
      setNoReceiptReason('');
      onSuccess();
    } catch (error) {
      console.error('手动入库失败:', error);
      alert(error instanceof Error ? error.message : '入库失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><PencilLine className="size-5" />手动填写入库</CardTitle>
        <CardDescription>标有 * 的信息为必填：试剂名称、规格、存储位置、单位、库存数量及风险等级。采购入库还需原始票据；无票据入库需填写原因。</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="试剂名称"
              required
              error={errors.name}
            >
              <Input
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="如：盐酸"
              />
            </FormField>
            <FormField label="CAS号" error={errors.casNumber}>
              <Input
                value={form.casNumber}
                onChange={(e) => update('casNumber', e.target.value)}
                placeholder="如：7647-01-0"
              />
            </FormField>
            <FormField label="规格" required error={errors.specification}>
              <Input
                value={form.specification}
                onChange={(e) => update('specification', e.target.value)}
                placeholder="如：500mL、10mg、AR 500mL/瓶"
              />
            </FormField>
            <FormField label="品牌">
              <Input
                value={form.brand}
                onChange={(e) => update('brand', e.target.value)}
                placeholder="如：国药集团"
              />
            </FormField>
            <FormField label="危险类别">
              <Input
                value={form.dangerCategory}
                onChange={(e) => update('dangerCategory', e.target.value)}
                placeholder="如：腐蚀性、易燃"
              />
            </FormField>
            <FormField label="存储位置" required error={errors.storageLocation}>
              <Input
                value={form.storageLocation}
                onChange={(e) => update('storageLocation', e.target.value)}
                placeholder="如：酸碱柜 A-1"
              />
              {locationAutoFilled && lastLocation && (
                <p className="flex items-center gap-1 text-xs text-sky-600">
                  <MapPin className="size-3" />
                  已自动填入上次入库位置「{lastLocation}」，如不准确请直接修改
                </p>
              )}
            </FormField>
            <FormField label="风险等级" required>
              <select
                value={form.riskLevel}
                onChange={(e) => update('riskLevel', e.target.value as 'LOW' | 'HIGH')}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="LOW">LOW（低风险）</option>
                <option value="HIGH">HIGH（高风险）</option>
              </select>
            </FormField>
            <FormField label="单位" required error={errors.unit}>
              <Input
                value={form.unit}
                onChange={(e) => update('unit', e.target.value)}
                placeholder="如：瓶、mL、g"
              />
            </FormField>
            <FormField label="库存数量" required error={errors.stockQuantity}>
              <Input
                type="number"
                min={0}
                value={form.stockQuantity}
                onChange={(e) => update('stockQuantity', e.target.value)}
                placeholder="如：1"
              />
            </FormField>
            <FormField label="批次号">
              <Input
                value={form.batchNumber}
                onChange={(e) => update('batchNumber', e.target.value)}
                placeholder="如：20240101"
              />
            </FormField>
            <FormField label="有效期">
              <Input
                type="date"
                value={form.expiryDate}
                onChange={(e) => update('expiryDate', e.target.value)}
              />
            </FormField>
          </div>

          <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-4">
            <div className="mb-3 flex items-start gap-2">
              <ReceiptText className="mt-0.5 size-4 text-sky-600" />
              <div>
                <p className="text-sm font-semibold text-gray-900">原始票据归档</p>
                <p className="text-xs text-gray-500">此模式仅保存票据原图，不调用 OCR；入库后管理员可在票据库筛选和下载。</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="票据文件" required={!noReceipt} error={errors.receipt}>
                <Input
                  ref={receiptInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  disabled={noReceipt}
                  onChange={(event) => {
                    setReceipt(event.target.files?.[0] ?? null);
                    setErrors((prev) => ({ ...prev, receipt: '' }));
                  }}
                />
              </FormField>
              <FormField label="票据日期" required={!noReceipt}>
                <Input type="date" value={receiptDate} disabled={noReceipt} onChange={(event) => setReceiptDate(event.target.value)} />
              </FormField>
            </div>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={noReceipt}
                onChange={(event) => {
                  setNoReceipt(event.target.checked);
                  if (event.target.checked) {
                    setReceipt(null);
                    if (receiptInputRef.current) receiptInputRef.current.value = '';
                  }
                }}
                className="size-4 rounded border-gray-300"
              />
              非采购来源，确实没有票据
            </label>
            {noReceipt && (
              <FormField label="无票据原因" required error={errors.noReceiptReason}>
                <Input value={noReceiptReason} onChange={(event) => setNoReceiptReason(event.target.value)} placeholder="如：历史库存盘点补录" />
              </FormField>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex cursor-pointer items-center gap-3 rounded-md border border-gray-200 p-3 hover:bg-gray-50">
              <input
                type="checkbox"
                checked={form.isHazardous}
                onChange={(e) => update('isHazardous', e.target.checked)}
                className="size-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
              />
              <div>
                <div className="text-sm font-medium text-gray-900">危化品</div>
                <div className="text-xs text-gray-500">具有危险特性的化学品</div>
              </div>
            </label>
            <label className="flex cursor-pointer items-center gap-3 rounded-md border border-gray-200 p-3 hover:bg-gray-50">
              <input
                type="checkbox"
                checked={form.isControlled}
                onChange={(e) => update('isControlled', e.target.checked)}
                className="size-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
              />
              <div>
                <div className="text-sm font-medium text-gray-900">管制品</div>
                <div className="text-xs text-gray-500">剧毒/易制毒/易制爆等受公安管制</div>
              </div>
            </label>
          </div>

          <div className="flex items-center justify-end gap-3 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setForm(INITIAL_FORM);
                setReceipt(null);
                if (receiptInputRef.current) receiptInputRef.current.value = '';
                setNoReceipt(false);
                setNoReceiptReason('');
              }}
              disabled={submitting}
            >
              重置
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {submitting ? (
                <><Loader2 className="size-4 animate-spin" />提交中...</>
              ) : (
                <><CheckCircle2 className="size-4" />确认入库</>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

interface ArchiveReagent {
  id: string;
  name: string;
  casNumber?: string | null;
  specification?: string | null;
}

function ReceiptArchiveForm({ onSuccess }: ManualEntryFormProps) {
  const [reagents, setReagents] = useState<ArchiveReagent[]>([]);
  const [reagentId, setReagentId] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    authFetch('/api/reagents?page=1&pageSize=100')
      .then(async (response) => {
        if (!response.ok) throw new Error('试剂列表加载失败');
        return response.json();
      })
      .then((result: { data?: ArchiveReagent[] }) => {
        if (active) setReagents(result.data ?? []);
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : '试剂列表加载失败'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reagentId || !receipt) {
      setError(!reagentId ? '请选择关联试剂' : '请选择票据文件');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const data = new FormData();
      data.set('reagentId', reagentId);
      data.set('receipt', receipt);
      data.set('receiptDate', receiptDate);
      data.set('archiveNote', note.trim());
      const response = await authFetch('/api/documents/receipts/archive', { method: 'POST', body: data });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || '票据补录失败');
      onSuccess();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '票据补录失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ArchiveRestore className="size-5" />补录遗漏票据</CardTitle>
        <CardDescription>为已有试剂补充原始票据，不执行 OCR，也不会新增或调整库存。</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          <FormField label="关联试剂" required>
            <select
              value={reagentId}
              onChange={(event) => setReagentId(event.target.value)}
              disabled={loading}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">{loading ? '正在加载试剂…' : '请选择试剂'}</option>
              {reagents.map((item) => (
                <option key={item.id} value={item.id}>{item.name}{item.casNumber ? ` · ${item.casNumber}` : ''}{item.specification ? ` · ${item.specification}` : ''}</option>
              ))}
            </select>
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="原始票据" required>
              <Input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setReceipt(event.target.files?.[0] ?? null)} />
            </FormField>
            <FormField label="票据日期" required>
              <Input type="date" value={receiptDate} onChange={(event) => setReceiptDate(event.target.value)} />
            </FormField>
          </div>
          <FormField label="补录说明">
            <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="如：补录 2026 年 8 月采购票据" />
          </FormField>
          <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-xs text-violet-700">
            系统只保存原始文件并建立关联，不调用 OCR，不生成新的入库台账，库存数量保持不变。
          </div>
          <div className="flex justify-end border-t pt-4">
            <Button type="submit" disabled={submitting || loading} className="bg-violet-600 hover:bg-violet-700">
              {submitting ? <><Loader2 className="size-4 animate-spin" />归档中…</> : <><ArchiveRestore className="size-4" />确认补录</>}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function FormField({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-gray-600">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
