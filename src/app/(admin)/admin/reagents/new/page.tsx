"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { createReagentSchema } from "@/lib/validations/reagent";
import { ArrowLeft, Loader2, PenTool, Sparkles, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select } from '@/arco-adapters/select';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SmilesDrawerModal } from "@/components/smiles-drawer-modal";
import type { RiskLevel } from "@/types";
import { authFetch } from "@/lib/auth-fetch";
import { useAuthStore } from "@/store/auth-store";

const reagentFormSchema = createReagentSchema;

type ReagentFormValues = z.infer<typeof reagentFormSchema>;

const RISK_OPTIONS: { value: RiskLevel; label: string }[] = [
  { value: "LOW", label: "低风险" },
  { value: "HIGH", label: "高风险" },
];

interface PubChemData {
  molecularFormula?: string | null;
  molecularWeight?: string | null;
  iupacName?: string | null;
  smiles?: string | null;
  structureImgUrl?: string | null;
}

export default function NewReagentPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");
  const userLabId = useAuthStore((s) => s.user?.labId ?? "");
  const userLabName = useAuthStore((s) => s.user?.labName ?? "当前实验室");

  // SMILES 相关状态
  const [smiles, setSmiles] = useState("");
  const [pubchemData, setPubchemData] = useState<PubChemData | null>(null);
  const [pubchemLoading, setPubchemLoading] = useState(false);
  const [pubchemError, setPubchemError] = useState("");
  const [smilesDrawerOpen, setSmilesDrawerOpen] = useState(false);
  // 询问是否手动填充 SMILES 的提示
  const [askManualSmiles, setAskManualSmiles] = useState(false);

  const {
    register,
    setError,
    clearErrors,
    setFocus,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<ReagentFormValues>({
    defaultValues: {
      name: "",
      casNumber: "",
      specification: "",
      brand: "",
      dangerCategory: "",
      riskLevel: "LOW",
      isHazardous: false,
      isControlled: false,
      storageLocation: "",
      stockQuantity: 0,
      minStock: 0,
      unit: "",
      batchNumber: "",
      expiryDate: "",
      labId: userLabId,
    },
  });

  // PubChem 自动获取 SMILES
  const handlePubchemLookup = async () => {
    const cas = watch("casNumber")?.trim();
    if (!cas) {
      setPubchemError("请先填写 CAS 号");
      return;
    }
    setPubchemLoading(true);
    setPubchemError("");
    setAskManualSmiles(false);
    try {
      const res = await authFetch(`/api/pubchem/lookup?cas=${encodeURIComponent(cas)}`);
      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || "PubChem 查询失败");
      }
      const data: PubChemData = result.data;
      setPubchemData(data);
      if (data.smiles) {
        setSmiles(data.smiles);
      } else {
        // PubChem 返回但无 SMILES → 询问是否手动绘制
        setAskManualSmiles(true);
      }
    } catch (err) {
      setPubchemError(err instanceof Error ? err.message : "查询失败");
      // 查询失败也询问是否手动绘制
      setAskManualSmiles(true);
    } finally {
      setPubchemLoading(false);
    }
  };

  const showFieldErrors = (details: Record<string, string[] | undefined>) => {
    const messages: string[] = [];
    let first: keyof ReagentFormValues | undefined;
    for (const [field, errors] of Object.entries(details)) {
      if (!errors?.length) continue;
      const key = field as keyof ReagentFormValues;
      setError(key, { type: 'validate', message: errors.join('；') });
      messages.push(...errors);
      first ??= key;
    }
    setServerError('请完善以下内容：' + [...new Set(messages)].join('；'));
    if (first) setFocus(first);
  };

  const onSubmit = async (data: ReagentFormValues) => {
    // 提交时实时从 auth store 获取 labId，确保拿到最新值
    const currentLabId = useAuthStore.getState().user?.labId;
    if (!currentLabId) {
      setServerError("无法获取实验室信息，请重新登录后再试");
      return;
    }
    clearErrors();
    const checked = reagentFormSchema.safeParse({ ...data, labId: currentLabId, expiryDate: data.expiryDate || null });
    if (!checked.success) {
      showFieldErrors(checked.error.flatten().fieldErrors);
      return;
    }
    setSubmitting(true);
    setServerError("");
    try {
      const payload = {
        ...checked.data,
        labId: currentLabId,
        expiryDate: data.expiryDate || null,
        smiles: smiles || "",
      };
      const res = await authFetch("/api/reagents", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const result = await res.json();
        if (result.details && typeof result.details === 'object') {
          showFieldErrors(result.details);
          return;
        }
        const msg = typeof result.details === "string"
          ? result.details
          : result.error ?? "创建失败";
        throw new Error(msg);
      }
      queryClient.invalidateQueries({ queryKey: ["reagents"] });
      router.push("/admin/reagents");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "创建失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push("/admin/reagents")}>
          <ArrowLeft className="size-5" />
        </Button>
        <h2 className="text-lg font-semibold">新增试剂</h2>
      </div>
      <p className="text-sm text-muted-foreground">标有 <span className="text-destructive">*</span> 的项目为必填：试剂名称、规格、存储位置和库存数量（可为 0）。所属实验室自动关联。</p>
      {serverError && <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{serverError}</div>}
      <form noValidate onSubmit={handleSubmit(onSubmit, fields => setServerError('请完善以下内容：' + Object.values(fields).map(field => field?.message).filter(Boolean).join('；')))} className="space-y-4">
        <Card>
          <CardHeader><CardTitle>基本信息</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="name">试剂名称 <span className="text-destructive">*</span></Label>
                <Input id="name" aria-required="true" aria-invalid={!!errors.name} placeholder="请输入试剂名称" {...register("name")} />
                {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="casNumber">CAS号</Label>
                <div className="flex gap-2">
                  <Input id="casNumber" placeholder="如: 7732-18-5" {...register("casNumber")} className="flex-1" />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handlePubchemLookup}
                    disabled={pubchemLoading}
                    className="border-cyan-400 text-cyan-600 hover:bg-cyan-50 hover:text-cyan-700"
                  >
                    {pubchemLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                    PubChem
                  </Button>
                </div>
                {errors.casNumber && <p className="text-xs text-destructive">{errors.casNumber.message}</p>}
                {pubchemError && <p className="text-xs text-destructive">{pubchemError}</p>}
                {pubchemData && (
                  <p className="text-xs text-emerald-600">
                    ✓ 已获取：{pubchemData.molecularFormula ?? "未知分子式"}
                    {pubchemData.molecularWeight ? `（MW: ${pubchemData.molecularWeight}）` : ""}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="specification">规格 <span className="text-destructive">*</span></Label>
                <Input id="specification" aria-required="true" aria-invalid={!!errors.specification} placeholder="如: AR 500mL/瓶" {...register("specification")} />
                {errors.specification && <p className="text-xs text-destructive">{errors.specification.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="brand">品牌</Label>
                <Input id="brand" placeholder="请输入品牌" {...register("brand")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dangerCategory">危险类别</Label>
                <Input id="dangerCategory" placeholder="如: 腐蚀性" {...register("dangerCategory")} />
              </div>
              <div className="space-y-1.5">
                <Label>风险等级</Label>
                <Controller name="riskLevel" control={control} render={({ field }) => (
                  <Select value={field.value} onChange={field.onChange} placeholder="选择风险等级" options={RISK_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))} className="w-full" />
                )} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="isHazardous">是否危化品</Label>
                <div className="flex h-8 items-center">
                  <Controller name="isHazardous" control={control} render={({ field }) => (
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  )} />
                  <span className="ml-2 text-sm text-muted-foreground">{watch("isHazardous") ? "是" : "否"}</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="isControlled">是否管制品</Label>
                <div className="flex h-8 items-center">
                  <Controller name="isControlled" control={control} render={({ field }) => (
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  )} />
                  <span className="ml-2 text-sm text-muted-foreground">{watch("isControlled") ? "是" : "否"}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* SMILES 化学结构信息 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PenTool className="size-4 text-cyan-600" />
              化学结构信息（SMILES）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="smiles">SMILES 字符串</Label>
                <div className="flex gap-2">
                  <Input
                    id="smiles"
                    placeholder="如: CCO（乙醇）；可由 PubChem 自动获取或手动绘制"
                    value={smiles}
                    onChange={(e) => setSmiles(e.target.value)}
                    className="flex-1 font-mono text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSmilesDrawerOpen(true)}
                    className="border-cyan-400 text-cyan-600 hover:bg-cyan-50 hover:text-cyan-700"
                  >
                    <PenTool className="size-3.5" />
                    绘制化学式
                  </Button>
                </div>
                {smiles && (
                  <p className="text-xs text-muted-foreground">
                    当前 SMILES：<code className="rounded bg-muted px-1.5 py-0.5 font-mono">{smiles}</code>
                  </p>
                )}
              </div>

              {/* 询问是否手动填充 SMILES */}
              {askManualSmiles && !smiles && (
                <div className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
                  <AlertCircle className="size-4 shrink-0 text-amber-600" />
                  <span className="flex-1 text-amber-800">
                    未通过 PubChem 自动获取到 SMILES（可能 CAS 号缺失或 PubChem 无此化合物）。
                    是否手动绘制化学式填充？
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-amber-400 text-amber-700 hover:bg-amber-100"
                    onClick={() => { setSmilesDrawerOpen(true); setAskManualSmiles(false); }}
                  >
                    手动绘制
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-amber-600 hover:bg-amber-100"
                    onClick={() => setAskManualSmiles(false)}
                  >
                    无需填充
                  </Button>
                </div>
              )}

              {/* PubChem 获取的附加信息 */}
              {pubchemData && (
                <div className="grid gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-xs sm:grid-cols-2">
                  {pubchemData.molecularFormula && (
                    <div><span className="font-medium text-emerald-800">分子式：</span><span className="text-emerald-700">{pubchemData.molecularFormula}</span></div>
                  )}
                  {pubchemData.molecularWeight && (
                    <div><span className="font-medium text-emerald-800">分子量：</span><span className="text-emerald-700">{pubchemData.molecularWeight}</span></div>
                  )}
                  {pubchemData.iupacName && (
                    <div className="sm:col-span-2"><span className="font-medium text-emerald-800">IUPAC 名称：</span><span className="text-emerald-700">{pubchemData.iupacName}</span></div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>库存与存储</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="stockQuantity">库存数量 <span className="text-destructive">*</span></Label>
                <Input id="stockQuantity" type="number" min={0} step={1} aria-required="true" aria-invalid={!!errors.stockQuantity} {...register("stockQuantity", { valueAsNumber: true })} />
                {errors.stockQuantity && <p className="text-xs text-destructive">{errors.stockQuantity.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="minStock">最低库存</Label>
                <Input id="minStock" type="number" min={0} {...register("minStock", { setValueAs: value => value === "" ? 0 : Number(value) })} />
                {errors.minStock && <p className="text-xs text-destructive">{errors.minStock.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unit">单位</Label>
                <Input id="unit" placeholder="如: 瓶、kg、L" {...register("unit")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="storageLocation">存储位置 <span className="text-destructive">*</span></Label>
                <Input id="storageLocation" aria-required="true" aria-invalid={!!errors.storageLocation} placeholder="如: A柜2层" {...register("storageLocation")} />
                {errors.storageLocation && <p className="text-xs text-destructive">{errors.storageLocation.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="batchNumber">批次号</Label>
                <Input id="batchNumber" placeholder="请输入批次号" {...register("batchNumber")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="expiryDate">有效期</Label>
                <Input id="expiryDate" type="date" {...register("expiryDate")} />
              </div>
              <div className="space-y-1.5">
                <Label>所属实验室 <span className="text-destructive">*</span></Label>
                <Input value={userLabName} disabled />
              </div>
            </div>
          </CardContent>
        </Card>
        {serverError && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{serverError}</div>
        )}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.push("/admin/reagents")}>取消</Button>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            提交
          </Button>
        </div>
      </form>

      {/* 化学式绘制弹窗（用于手动填充 SMILES） */}
      <SmilesDrawerModal
        open={smilesDrawerOpen}
        onClose={() => setSmilesDrawerOpen(false)}
        onSearch={(s) => {
          setSmiles(s);
          setSmilesDrawerOpen(false);
        }}
        initialSmiles={smiles}
        title="绘制化学式填充 SMILES"
      />
    </div>
  );
}
