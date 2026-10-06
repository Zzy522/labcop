"use client";

import { useEffect, useState, useCallback } from "react";
import {
  AlertTriangle, Clock, ShieldAlert, ShoppingCart, Download, CheckCircle,
  Loader2, Trash2, PackagePlus, FileText, TrendingDown,
} from "lucide-react";
import { Tabs } from "@/arco-adapters/tabs";
import { DropdownMenu } from "@/arco-adapters/dropdown";
import { Dialog } from "@/arco-adapters/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { authFetch } from "@/lib/auth-fetch";
import { RESTOCK_FEATURE_ENABLED } from "@/lib/features";

interface LowStockItem {
  id: string; name: string; casNumber: string | null; stockQuantity: number; minStock: number; storageLocation: string | null; unit: string | null; brand: string | null;
}
interface ExpiringItem {
  id: string; name: string; casNumber: string | null; expiryDate: string | null; riskLevel: string; storageLocation: string | null;
}
interface RiskEventItem {
  id: string; type: string; level: string; description: string; reagentId: string | null; deviceId: string | null; isResolved: boolean; createdAt: string; reagent: { id: string; name: string } | null; device: { id: string; name: string } | null;
}
interface PurchaseSuggestion {
  id: string; name: string; brand: string | null; stockQuantity: number; minStock: number; suggestedQuantity: number; unit: string | null;
}
interface AlertsData {
  lowStock: LowStockItem[]; expiring: ExpiringItem[]; expired: ExpiringItem[]; riskEvents: RiskEventItem[]; purchaseSuggestions: PurchaseSuggestion[];
}

const eventTypeLabels: Record<string, string> = { STOCK_LOW: "库存不足", EXPIRING: "临期预警", EXPIRED: "过期预警", INCOMPATIBLE: "试剂不兼容", UNAUTHORIZED: "未授权使用", DEVICE_ABNORMAL: "设备异常" };
const levelColorMap: Record<string, string> = { INFO: "bg-blue-100 text-blue-800", WARNING: "bg-orange-100 text-orange-800", CRITICAL: "bg-red-100 text-red-800" };
const levelLabels: Record<string, string> = { INFO: "提示", WARNING: "警告", CRITICAL: "严重" };

export function AlertsSection() {
  const [data, setData] = useState<AlertsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());
  const [disposingId, setDisposingId] = useState<string | null>(null);
  const [restockItem, setRestockItem] = useState<PurchaseSuggestion | null>(null);
  const [restockQty, setRestockQty] = useState<number>(0);
  const [restockNote, setRestockNote] = useState("");
  const [restockLoading, setRestockLoading] = useState(false);
  const [disposeReason, setDisposeReason] = useState("");
  const [disposeLoading, setDisposeLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const fetchAlerts = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await authFetch("/api/alerts");
      if (!res.ok) throw new Error("获取预警数据失败");
      const json = await res.json();
      setData(json);
    } catch (err) { setError(err instanceof Error ? err.message : "未知错误"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  const showActionMsg = (msg: string) => {
    setActionMessage(msg);
    setTimeout(() => setActionMessage(null), 3000);
  };

  const handleResolve = async (eventId: string) => {
    setResolvingIds((prev) => new Set(prev).add(eventId));
    try {
      const res = await authFetch(`/api/risk-events/${eventId}/resolve`, { method: "PATCH" });
      if (!res.ok) throw new Error("标记失败");
      setData((prev) => prev ? { ...prev, riskEvents: prev.riskEvents.filter((e) => e.id !== eventId) } : prev);
      showActionMsg("已标记为已解决");
    } catch { /* silent */ }
    finally { setResolvingIds((prev) => { const next = new Set(prev); next.delete(eventId); return next; }); }
  };

  const handleDispose = async () => {
    if (!disposingId) return;
    setDisposeLoading(true);
    try {
      const res = await authFetch(`/api/reagents/${disposingId}/dispose`, {
        method: "POST",
        body: JSON.stringify({ reason: disposeReason || undefined }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "处置失败");
      }
      setData((prev) => prev ? { ...prev, expired: prev.expired.filter((r) => r.id !== disposingId) } : prev);
      setDisposingId(null);
      setDisposeReason("");
      showActionMsg("试剂已处置");
      fetchAlerts();
    } catch (err) {
      alert(err instanceof Error ? err.message : "处置失败");
    } finally {
      setDisposeLoading(false);
    }
  };

  const handleRestock = async () => {
    if (!restockItem || restockQty <= 0) return;
    setRestockLoading(true);
    try {
      const res = await authFetch(`/api/reagents/${restockItem.id}/restock`, {
        method: "POST",
        body: JSON.stringify({ quantity: restockQty, note: restockNote || undefined }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "补货失败");
      }
      setRestockItem(null);
      setRestockQty(0);
      setRestockNote("");
      showActionMsg(`已补货 ${restockQty}${restockItem.unit ?? ""}`);
      fetchAlerts();
    } catch (err) {
      alert(err instanceof Error ? err.message : "补货失败");
    } finally {
      setRestockLoading(false);
    }
  };

  const handleExportPurchase = () => {
    if (!data?.purchaseSuggestions.length) return;
    const headers = ["试剂名称", "品牌", "当前库存", "最低库存", "建议采购量", "单位"];
    const rows = data.purchaseSuggestions.map((s) => [s.name, s.brand ?? "", String(s.stockQuantity), String(s.minStock), String(s.suggestedQuantity), s.unit ?? ""]);
    downloadCsv(headers, rows, `采购清单_${formatDate(new Date())}.csv`);
  };

  const handleExportReport = async (type: string) => {
    try {
      const res = await authFetch(`/api/reports/export?type=${type}`);
      if (!res.ok) throw new Error("导出失败");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("Content-Disposition");
      const match = disposition?.match(/filename\*=UTF-8''(.+)/);
      a.download = match ? decodeURIComponent(match[1]) : `${type}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch { /* silent */ }
  };

  if (loading) return <AlertsLoadingSkeleton />;
  if (error) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive"><AlertTitle>加载失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>
        <Button onClick={fetchAlerts} variant="outline">重新加载</Button>
      </div>
    );
  }
  if (!data) return null;

  const tabItems = [
    {
      key: "lowStock",
      label: <span className="inline-flex items-center gap-1.5"><AlertTriangle className="size-4" />低库存预警{data.lowStock.length > 0 && <Badge className="ml-1 bg-red-500 text-white">{data.lowStock.length}</Badge>}</span>,
      content: (
        <div className="space-y-4">
          <AlertsSummaryBar items={[
            { label: "低库存试剂", value: data.lowStock.length, icon: TrendingDown, color: "text-red-600" },
            { label: "临期试剂", value: data.expiring.length, icon: Clock, color: "text-orange-600" },
            { label: "已过期", value: data.expired.length, icon: AlertTriangle, color: "text-red-600" },
            { label: "风险事件", value: data.riskEvents.length, icon: ShieldAlert, color: "text-amber-600" },
          ]} />
          {data.lowStock.length === 0 ? <AlertsEmptyState message="暂无低库存预警数据" /> : (
            <Table>
              <TableHeader><TableRow><TableHead>试剂名称</TableHead><TableHead>CAS号</TableHead><TableHead className="text-right">当前库存</TableHead><TableHead className="text-right">最低库存</TableHead><TableHead className="text-right">缺口</TableHead><TableHead>存储位置</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.lowStock.map((item) => {
                  const gap = item.minStock - item.stockQuantity;
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell>{item.casNumber ?? "-"}</TableCell>
                      <TableCell className="text-right">{item.stockQuantity}{item.unit ?? ""}</TableCell>
                      <TableCell className="text-right">{item.minStock}{item.unit ?? ""}</TableCell>
                      <TableCell className="text-right"><span className="font-semibold text-red-600">-{gap}</span></TableCell>
                      <TableCell>{item.storageLocation ?? "-"}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" disabled={!RESTOCK_FEATURE_ENABLED} title="补货功能迭代中，当前版本暂不可用" onClick={() => {
                          setRestockItem({
                            id: item.id, name: item.name, brand: item.brand,
                            stockQuantity: item.stockQuantity, minStock: item.minStock,
                            suggestedQuantity: Math.max(item.minStock * 2 - item.stockQuantity, item.minStock),
                            unit: item.unit,
                          });
                          setRestockQty(Math.max(item.minStock * 2 - item.stockQuantity, item.minStock));
                          setRestockNote("");
                        }}>
                          <PackagePlus className="size-3.5" />功能迭代中
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      ),
    },
    {
      key: "expiring",
      label: <span className="inline-flex items-center gap-1.5"><Clock className="size-4" />临期过期{(data.expiring.length + data.expired.length) > 0 && <Badge className="ml-1 bg-orange-500 text-white">{data.expiring.length + data.expired.length}</Badge>}</span>,
      content: (
        <div className="space-y-6">
          <AlertsSummaryBar items={[
            { label: "临期试剂（30天内）", value: data.expiring.length, icon: Clock, color: "text-orange-600" },
            { label: "已过期试剂", value: data.expired.length, icon: AlertTriangle, color: "text-red-600" },
          ]} />
          {data.expiring.length === 0 && data.expired.length === 0 ? <AlertsEmptyState message="暂无临期过期数据" /> : (
            <>
              {data.expiring.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-orange-600">临期试剂（30天内过期）</h3>
                  <Table>
                    <TableHeader><TableRow><TableHead>试剂名称</TableHead><TableHead>CAS号</TableHead><TableHead>有效期</TableHead><TableHead>状态</TableHead><TableHead>风险等级</TableHead><TableHead>存储位置</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {data.expiring.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.name}</TableCell>
                          <TableCell>{item.casNumber ?? "-"}</TableCell>
                          <TableCell>{item.expiryDate ? new Date(item.expiryDate).toLocaleDateString("zh-CN") : "-"}</TableCell>
                          <TableCell><Badge className="bg-orange-100 text-orange-800">临期</Badge></TableCell>
                          <TableCell><RiskLevelBadge level={item.riskLevel} /></TableCell>
                          <TableCell>{item.storageLocation ?? "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {data.expired.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-red-600">已过期试剂</h3>
                  <Table>
                    <TableHeader><TableRow><TableHead>试剂名称</TableHead><TableHead>CAS号</TableHead><TableHead>有效期</TableHead><TableHead>状态</TableHead><TableHead>风险等级</TableHead><TableHead>存储位置</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {data.expired.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.name}</TableCell>
                          <TableCell>{item.casNumber ?? "-"}</TableCell>
                          <TableCell>{item.expiryDate ? new Date(item.expiryDate).toLocaleDateString("zh-CN") : "-"}</TableCell>
                          <TableCell><Badge className="bg-red-100 text-red-800">过期</Badge></TableCell>
                          <TableCell><RiskLevelBadge level={item.riskLevel} /></TableCell>
                          <TableCell>{item.storageLocation ?? "-"}</TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="outline" className="text-red-600 hover:bg-red-50" onClick={() => { setDisposingId(item.id); setDisposeReason(""); }}>
                              <Trash2 className="size-3.5" />处置
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </div>
      ),
    },
    {
      key: "riskEvents",
      label: <span className="inline-flex items-center gap-1.5"><ShieldAlert className="size-4" />风险事件{data.riskEvents.length > 0 && <Badge className="ml-1 bg-amber-500 text-white">{data.riskEvents.length}</Badge>}</span>,
      content: (
        <div className="space-y-4">
          <AlertsSummaryBar items={[
            { label: "未解决风险", value: data.riskEvents.length, icon: ShieldAlert, color: "text-amber-600" },
            { label: "严重", value: data.riskEvents.filter(e => e.level === 'CRITICAL').length, icon: AlertTriangle, color: "text-red-600" },
            { label: "警告", value: data.riskEvents.filter(e => e.level === 'WARNING').length, icon: ShieldAlert, color: "text-orange-600" },
            { label: "提示", value: data.riskEvents.filter(e => e.level === 'INFO').length, icon: FileText, color: "text-blue-600" },
          ]} />
          {data.riskEvents.length === 0 ? <AlertsEmptyState message="暂无风险事件数据" /> : (
            <div className="grid gap-4 sm:grid-cols-2">
              {data.riskEvents.map((event) => (
                <Card key={event.id}>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">{eventTypeLabels[event.type] ?? event.type}</Badge>
                      <Badge className={`text-xs ${levelColorMap[event.level] ?? ""}`}>{levelLabels[event.level] ?? event.level}</Badge>
                    </div>
                    <p className="text-sm">{event.description}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {event.reagent && <span>关联试剂：{event.reagent.name}</span>}
                      {event.device && <span>关联设备：{event.device.name}</span>}
                      <span>创建时间：{new Date(event.createdAt).toLocaleString("zh-CN")}</span>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => handleResolve(event.id)} disabled={resolvingIds.has(event.id)}>
                      {resolvingIds.has(event.id) ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle className="size-3.5" />}
                      标记已解决
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "purchase",
      label: <span className="inline-flex items-center gap-1.5"><ShoppingCart className="size-4" />采购建议{data.purchaseSuggestions.length > 0 && <Badge className="ml-1 bg-blue-500 text-white">{data.purchaseSuggestions.length}</Badge>}</span>,
      content: (
        <div className="space-y-4">
          <AlertsSummaryBar items={[
            { label: "需采购试剂", value: data.purchaseSuggestions.length, icon: ShoppingCart, color: "text-blue-600" },
            { label: "建议采购总量", value: data.purchaseSuggestions.reduce((s, r) => s + r.suggestedQuantity, 0), icon: PackagePlus, color: "text-teal-600" },
          ]} />
          {data.purchaseSuggestions.length === 0 ? <AlertsEmptyState message="暂无采购建议数据" /> : (
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button variant="outline" onClick={handleExportPurchase}><Download className="size-4" />导出采购清单</Button>
              </div>
              <Table>
                <TableHeader><TableRow><TableHead>试剂名称</TableHead><TableHead>品牌</TableHead><TableHead className="text-right">当前库存</TableHead><TableHead className="text-right">最低库存</TableHead><TableHead className="text-right">建议采购量</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.purchaseSuggestions.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell>{item.brand ?? "-"}</TableCell>
                      <TableCell className="text-right">{item.stockQuantity}{item.unit ?? ""}</TableCell>
                      <TableCell className="text-right">{item.minStock}{item.unit ?? ""}</TableCell>
                      <TableCell className="text-right"><span className="font-semibold text-blue-600">+{item.suggestedQuantity}</span>{item.unit ?? ""}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" disabled={!RESTOCK_FEATURE_ENABLED} title="补货功能迭代中，当前版本暂不可用" onClick={() => {
                          setRestockItem(item);
                          setRestockQty(item.suggestedQuantity);
                          setRestockNote("");
                        }}>
                          <PackagePlus className="size-3.5" />功能迭代中
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-amber-100 to-red-100 text-amber-600">
            <ShieldAlert className="size-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">安全预警</h3>
            <p className="text-xs text-gray-500">监控实验室安全风险，及时处理预警</p>
          </div>
        </div>
        <DropdownMenu
          trigger={<Button variant="outline" size="sm"><Download className="size-4" />导出报表</Button>}
          items={[
            { key: "reagents", label: "试剂台账", onClick: () => handleExportReport("reagents") },
            { key: "devices", label: "设备台账", onClick: () => handleExportReport("devices") },
            { key: "requisitions", label: "领用记录", onClick: () => handleExportReport("requisitions") },
            { key: "risk-events", label: "风险事件", onClick: () => handleExportReport("risk-events") },
          ]}
        />
      </div>

      {actionMessage && (
        <Alert>
          <CheckCircle className="size-4" />
          <AlertDescription>{actionMessage}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultActiveKey="lowStock" items={tabItems} />

      {/* 处置过期试剂弹窗 */}
      <Dialog
        open={!!disposingId}
        onOpenChange={(open) => { if (!open) setDisposingId(null); }}
        title="处置过期试剂"
        description="确认处置后，该试剂库存将归零，并记录处置台账。"
        footer={
          <>
            <Button variant="outline" onClick={() => setDisposingId(null)} disabled={disposeLoading}>取消</Button>
            <Button onClick={handleDispose} disabled={disposeLoading} className="bg-red-600 text-white hover:bg-red-700">
              {disposeLoading ? "处置中..." : "确认处置"}
            </Button>
          </>
        }
      >
        <div className="space-y-3 py-2">
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            处置操作将清零试剂库存，此操作不可撤销。
          </div>
          <div className="space-y-2">
            <Label>处置原因（可选）</Label>
            <Textarea
              placeholder="如：过期销毁、退货等"
              value={disposeReason}
              onChange={(e) => setDisposeReason(e.target.value)}
              rows={3}
            />
          </div>
        </div>
      </Dialog>

      {/* 补货入库弹窗 */}
      <Dialog
        open={!!restockItem}
        onOpenChange={(open) => { if (!open) setRestockItem(null); }}
        title="补货入库"
        description={restockItem ? `为「${restockItem.name}」补充库存` : ""}
        footer={
          <>
            <Button variant="outline" onClick={() => setRestockItem(null)} disabled={restockLoading}>取消</Button>
            <Button onClick={handleRestock} disabled={restockLoading || restockQty <= 0} className="bg-blue-600 text-white hover:bg-blue-700">
              {restockLoading ? "入库中..." : "确认入库"}
            </Button>
          </>
        }
      >
        <div className="space-y-4 py-2">
          {restockItem && (
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg bg-gray-50 p-3 text-center">
                <div className="text-xs text-gray-500">当前库存</div>
                <div className="mt-1 font-semibold">{restockItem.stockQuantity}{restockItem.unit ?? ""}</div>
              </div>
              <div className="rounded-lg bg-gray-50 p-3 text-center">
                <div className="text-xs text-gray-500">最低库存</div>
                <div className="mt-1 font-semibold">{restockItem.minStock}{restockItem.unit ?? ""}</div>
              </div>
              <div className="rounded-lg bg-blue-50 p-3 text-center">
                <div className="text-xs text-gray-500">建议采购</div>
                <div className="mt-1 font-semibold text-blue-600">{restockItem.suggestedQuantity}{restockItem.unit ?? ""}</div>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label>补货数量 *</Label>
            <Input
              type="number"
              min={1}
              value={restockQty}
              onChange={(e) => setRestockQty(Number(e.target.value))}
              placeholder="请输入补货数量"
            />
          </div>
          <div className="space-y-2">
            <Label>备注（可选）</Label>
            <Textarea
              placeholder="如：供应商、批次号等"
              value={restockNote}
              onChange={(e) => setRestockNote(e.target.value)}
              rows={2}
            />
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function AlertsSummaryBar({ items }: { items: { label: string; value: number; icon: React.ElementType; color: string }[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {items.map((item, i) => (
        <div key={i} className="rounded-lg border border-gray-100 bg-white p-3">
          <div className="flex items-center gap-2">
            <item.icon className={`size-4 ${item.color}`} />
            <span className="text-xs text-gray-500">{item.label}</span>
          </div>
          <div className={`mt-1 text-xl font-bold ${item.color}`}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}

function AlertsEmptyState({ message }: { message: string }) {
  return <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-dashed"><p className="text-sm text-muted-foreground">{message}</p></div>;
}

function RiskLevelBadge({ level }: { level: string }) {
  const colorMap: Record<string, string> = { LOW: "bg-green-100 text-green-800", HIGH: "bg-red-100 text-red-800" };
  const labelMap: Record<string, string> = { LOW: "低风险", HIGH: "高风险" };
  return <Badge className={`text-xs ${colorMap[level] ?? ""}`}>{labelMap[level] ?? level}</Badge>;
}

function AlertsLoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><Skeleton className="h-8 w-32" /><Skeleton className="h-8 w-24" /></div>
      <Skeleton className="h-10 w-full max-w-lg" />
      <div className="space-y-3"><Skeleton className="h-10 w-full" />{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
    </div>
  );
}

function downloadCsv(headers: string[], rows: string[][], fileName: string) {
  const escapeField = (field: string): string => {
    if (field.includes(",") || field.includes('"') || field.includes("\n")) return `"${field.replace(/"/g, '""')}"`;
    return field;
  };
  const headerLine = headers.map(escapeField).join(",");
  const dataLines = rows.map((row) => row.map(escapeField).join(","));
  const csvContent = [headerLine, ...dataLines].join("\n");
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}
