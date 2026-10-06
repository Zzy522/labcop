"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, FlaskConical, MapPin, Package, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { authFetch } from "@/lib/auth-fetch";
import { getStockDisplayText } from "@/lib/reagent-units";

interface ReagentDetailProps {
  backHref: string;
  backLabel: string;
}

interface ReagentDetailData {
  id: string;
  name: string;
  casNumber?: string | null;
  brand?: string | null;
  specification?: string | null;
  purity?: string | null;
  riskLevel?: "LOW" | "HIGH" | null;
  isHazardous?: boolean;
  isControlled?: boolean;
  storageLocation?: string | null;
  stockQuantity?: number;
  totalStockedBottles?: number | null;
  minStock?: number;
  unit?: string | null;
  capacityPerUnit?: number | null;
  capacityUnit?: string | null;
  expiryDate?: string | null;
  molecularFormula?: string | null;
  molecularWeight?: string | null;
  iupacName?: string | null;
  smiles?: string | null;
}

function detailRows(reagent: ReagentDetailData) {
  return [
    ["CAS 号", reagent.casNumber || "未填写"],
    ["品牌", reagent.brand || "未填写"],
    ["规格", reagent.specification || "未填写"],
    ["备注（浓度/纯度）", reagent.purity || "未填写"],
    ["存放位置", reagent.storageLocation || "未填写"],
    ["有效期", reagent.expiryDate ? new Date(reagent.expiryDate).toLocaleDateString("zh-CN") : "未填写"],
    ["分子式", reagent.molecularFormula || "未填写"],
    ["分子量", reagent.molecularWeight || "未填写"],
    ["IUPAC 名称", reagent.iupacName || "未填写"],
    ["SMILES", reagent.smiles || "未填写"],
  ];
}

export function ReagentDetail({ backHref, backLabel }: ReagentDetailProps) {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const reagentId = params.id;
  const { data, isLoading, isError, error } = useQuery<ReagentDetailData>({
    queryKey: ["reagent", reagentId],
    queryFn: async () => {
      const response = await authFetch(`/api/reagents/${reagentId}`);
      if (!response.ok) throw new Error("试剂详情加载失败");
      return response.json();
    },
    enabled: Boolean(reagentId),
  });

  if (isLoading) {
    return <Skeleton className="h-80 w-full rounded-lg" />;
  }

  if (isError || !data) {
    return (
      <div className="space-y-4">
        <Button variant="outline" onClick={() => router.push(backHref)}><ArrowLeft className="size-4" />返回{backLabel}</Button>
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>无法加载试剂详情</AlertTitle>
          <AlertDescription>{error instanceof Error ? error.message : "请稍后重试"}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const stockStatus = (data.stockQuantity ?? 0) <= (data.minStock ?? 0) ? "库存偏低" : "库存正常";
  // 存量展示：主显示为剩余总量（质量/体积），副显示单瓶容量规格
  // 不显示剩余瓶数，避免浮点精度问题（如 3.5999999999999996 瓶）
  const stockDisplay = getStockDisplayText({
    stockQuantity: data.stockQuantity ?? 0,
    unit: data.unit,
    capacityPerUnit: data.capacityPerUnit,
    capacityUnit: data.capacityUnit,
    totalStockedBottles: data.totalStockedBottles,
  });
  const stockPrimary = stockDisplay.primary;
  const stockSecondary = stockDisplay.secondary;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Button variant="outline" onClick={() => router.push(backHref)}><ArrowLeft className="size-4" />返回{backLabel}</Button>
      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-7">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-cyan-50 text-cyan-700"><FlaskConical className="size-6" /></div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold text-slate-900">{data.name}</h2>
                {data.isHazardous && <Badge className="bg-red-100 text-red-700 hover:bg-red-100">危化品</Badge>}
                {data.isControlled && <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100">管制品</Badge>}
              </div>
              <p className="mt-1 text-sm text-slate-500">{data.casNumber ? `CAS ${data.casNumber}` : "未登记 CAS 号"}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 self-start rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <div className="flex items-center gap-2">
              <Package className="size-4 text-teal-600" />
              <span className="font-semibold text-base">{stockPrimary}</span>
              <span className="text-slate-400 text-xs">{stockStatus}</span>
            </div>
            {stockSecondary && (
              <span className="text-[11px] text-slate-400">{stockSecondary}</span>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader><CardTitle className="text-base">基础信息</CardTitle></CardHeader>
          <CardContent className="divide-y divide-slate-100">
            {detailRows(data).map(([label, value]) => (
              <div key={label} className="grid grid-cols-[96px_1fr] gap-4 py-3 text-sm">
                <span className="text-slate-500">{label}</span>
                <span className="break-all font-medium text-slate-800">{value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <div className="space-y-5">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader><CardTitle className="text-base">安全状态</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center gap-2 text-slate-700"><ShieldCheck className="size-4 text-teal-600" />风险等级：{data.riskLevel === "HIGH" ? "高风险" : "低风险"}</div>
              <div className="flex items-center gap-2 text-slate-700"><MapPin className="size-4 text-sky-600" />{data.storageLocation || "暂未指定存放位置"}</div>
            </CardContent>
          </Card>
          <Card className="border-slate-200 bg-slate-50/70 shadow-sm">
            <CardContent className="p-5 text-sm leading-6 text-slate-600">请按实验室安全规范完成领用、存储和处置操作。</CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
