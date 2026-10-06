"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, AlertTriangle, FlaskConical, MapPin, Calendar, User, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authFetch } from "@/lib/auth-fetch";
import { format } from "date-fns";
import { isValidCasNumber } from "@/lib/cas-number";

interface ReagentDetail {
  id: string;
  name: string;
  casNumber: string | null;
  brand: string | null;
  specification: string | null;
  purity: string | null;
  dangerCategory: string | null;
  riskLevel: string;
  isHazardous: boolean;
  isControlled: boolean;
  storageLocation: string | null;
  stockQuantity: number;
  version: number;
  archivedAt: string | null;
  minStock: number;
  unit: string | null;
  expiryDate: string | null;
  structureImgUrl: string | null;
  molecularFormula: string | null;
  molecularWeight: string | null;
  iupacName: string | null;
  smiles: string | null;
  stockInDate: string | null;
  stockInOperatorId: string | null;
  stockInOperator?: { id: string; name: string } | null;
  lab?: { id: string; name: string } | null;
  reagentLogs?: Array<{
    id: string;
    action: string;
    quantity: number;
    reason: string | null;
    createdAt: string;
    operator: { id: string; name: string };
  }>;
}

const RISK_LEVEL_MAP: Record<string, { label: string; className: string }> = {
  LOW: { label: "低风险", className: "bg-green-100 text-green-800" },
  HIGH: { label: "高风险", className: "bg-red-100 text-red-800" },
};

export default function ReagentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [reagent, setReagent] = useState<ReagentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    authFetch(`/api/reagents/${id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("加载失败");
        return res.json();
      })
      .then((data) => setReagent(data))
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, [id]);

  async function adjustInventory() {
    if (!reagent || adjusting) return;
    const value = window.prompt(`盘点后的实际库存（单位：${reagent.unit || '瓶'}）`, String(reagent.stockQuantity));
    if (value === null || !value.trim()) return;
    const quantity = Number(value);
    if (!Number.isFinite(quantity) || quantity < 0) { window.alert('请输入有效的非负数量'); return; }
    const reason = window.prompt('请填写盘点调整原因（至少四个字，会写入台账）');
    if (!reason || reason.trim().length < 4) return;
    setAdjusting(true);
    try {
      const response = await authFetch(`/api/reagents/${id}/adjust`, { method: 'POST', body: JSON.stringify({ quantity, reason: reason.trim(), version: reagent.version }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '盘点失败');
      const fresh = await authFetch(`/api/reagents/${id}`);
      if (!fresh.ok) throw new Error('盘点已提交，请刷新查看');
      setReagent(await fresh.json());
      window.alert(body.message);
    } catch (error) { window.alert(error instanceof Error ? error.message : '盘点失败'); }
    finally { setAdjusting(false); }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-gray-400" />
        <span className="ml-2 text-sm text-gray-500">加载中...</span>
      </div>
    );
  }

  if (error || !reagent) {
    return (
      <div className="py-20 text-center">
        <AlertTriangle className="size-10 mx-auto mb-3 text-red-400" />
        <p className="text-sm text-red-500">{error || "未找到试剂"}</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/admin/reagents")}>
          返回列表
        </Button>
      </div>
    );
  }

  const risk = RISK_LEVEL_MAP[reagent.riskLevel] ?? RISK_LEVEL_MAP.LOW;
  const invalidCas = Boolean(reagent.casNumber && !isValidCasNumber(reagent.casNumber));
  const hasStructureSource = Boolean(
    reagent.smiles || reagent.structureImgUrl || (reagent.casNumber && !invalidCas)
  );
  const structureUrl = `/api/reagents/${encodeURIComponent(reagent.id)}/structure`;

  return (
    <div className="space-y-4">
      {!reagent.archivedAt && <Button variant="outline" disabled={adjusting} onClick={() => void adjustInventory()}>{adjusting ? "保存中…" : "盘点调整（生成流水）"}</Button>}
      {/* 顶部：返回按钮 + 标题 */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => router.push("/admin/reagents")}>
          <ArrowLeft className="size-4" />
          返回
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900">{reagent.name}</h2>
            <Badge className={risk.className}>{risk.label}</Badge>
            {reagent.isControlled && (
              <Badge className="bg-purple-100 text-purple-700">管制品</Badge>
            )}
            {reagent.isHazardous && (
              <Badge className="bg-red-100 text-red-700">危化品</Badge>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">CAS: {reagent.casNumber || "-"} · 试剂详情</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 左侧：结构式 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">结构式</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            {hasStructureSource && !imgError ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={structureUrl}
                alt={`${reagent.name} 结构式`}
                className="max-w-full max-h-64 object-contain"
                onError={() => setImgError(true)}
              />
            ) : (
              <div className="flex h-48 flex-col items-center justify-center text-gray-300">
                <FlaskConical className="size-12 mb-2" />
                <span className="text-center text-xs">
                  {invalidCas ? "CAS 号校验位不正确，请核对后补全" : "暂无结构式"}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 右侧：基本信息 */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">基本信息</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <InfoItem label="试剂名称" value={reagent.name} />
              <InfoItem label="CAS 号" value={reagent.casNumber || "-"} mono />
              <InfoItem label="品牌" value={reagent.brand || "-"} />
              <InfoItem label="规格" value={reagent.specification || "-"} />
              <InfoItem label="备注（浓度/纯度）" value={reagent.purity || "-"} />
              <InfoItem label="分子式" value={reagent.molecularFormula || "-"} />
              <InfoItem label="分子量" value={reagent.molecularWeight || "-"} />
              <InfoItem label="IUPAC 名称" value={reagent.iupacName || "-"} />
              <InfoItem label="危险类别" value={reagent.dangerCategory || "-"} />
              <InfoItem label="存储位置" value={reagent.storageLocation || "-"} icon={MapPin} />
              <InfoItem
                label="库存量"
                value={`${reagent.stockQuantity} ${reagent.unit || ""}`}
                icon={Package}
              />
              <InfoItem label="最低库存" value={`${reagent.minStock} ${reagent.unit || ""}`} />
              <InfoItem
                label="有效期"
                value={reagent.expiryDate ? format(new Date(reagent.expiryDate), "yyyy-MM-dd") : "-"}
                icon={Calendar}
              />
              <InfoItem
                label="入库日期"
                value={reagent.stockInDate ? format(new Date(reagent.stockInDate), "yyyy-MM-dd") : "-"}
                icon={Calendar}
              />
              <InfoItem
                label="入库人"
                value={reagent.stockInOperator?.name || "-"}
                icon={User}
              />
              <InfoItem label="所属实验室" value={reagent.lab?.name || "-"} />
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-500">SMILES</label>
                <code className="mt-1 block min-h-9 rounded bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700 break-all">
                  {reagent.smiles || "-"}
                </code>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 台账记录 */}
      {reagent.reagentLogs && reagent.reagentLogs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">台账记录</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {reagent.reagentLogs.map((log) => (
                <div key={log.id} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
                  <div className="size-8 rounded-full bg-gray-100 flex items-center justify-center text-xs text-gray-500">
                    {log.operator.name.charAt(0)}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm text-gray-800">
                      <span className="font-medium">{log.operator.name}</span>
                      <span className="text-gray-500 ml-1">{log.action}</span>
                      <span className="text-gray-400 ml-1">· {log.quantity}{reagent.unit || ""}</span>
                    </div>
                    {log.reason && <div className="text-xs text-gray-500 mt-0.5">{log.reason}</div>}
                  </div>
                  <div className="text-xs text-gray-400">
                    {format(new Date(log.createdAt), "yyyy-MM-dd HH:mm")}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function InfoItem({
  label,
  value,
  mono,
  icon: Icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-500">{label}</label>
      <div className={`mt-1 text-sm text-gray-800 flex items-center gap-1 ${mono ? "font-mono" : ""}`}>
        {Icon && <Icon className="size-3.5 text-gray-400" />}
        {value}
      </div>
    </div>
  );
}
