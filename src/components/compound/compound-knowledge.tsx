'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import {
  FlaskRound,
  Plus,
  Search,
  ArrowLeft,
  Activity,
  FileText,
  History,
  Loader2,
  Trash2,
  ExternalLink,
  FlaskConical,
  Beaker,
  Microscope,
  PenLine,
  X,
  AlertCircle,
  Download,
  Upload,
  ImageOff,
  ZoomIn,
  MapPin,
  Package,
  Calculator,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { SmilesDrawerModal } from '@/components/smiles-drawer-modal';
import { ImportDialog } from '@/components/shared/import-dialog';
import { authFetch } from '@/lib/auth-fetch';
import { toast } from '@/components/ui/toast';
import { useAuthStore } from '@/store/auth-store';
import { loadRDKit, getMolInfo, filterByExactMatch, filterBySubstructure } from '@/lib/rdkit';
import { getStockDisplayText } from '@/lib/reagent-units';
import { cn } from '@/lib/utils';
import { getStandardSmiles, runKetcherOperation, type KetcherApi } from '@/lib/ketcher';

// 动态加载 Ketcher 分子绘图器（避免 SSR）
const KetcherEditor = dynamic(
  () => import('@/components/ketcher-editor').then((m) => m.KetcherEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[400px] items-center justify-center gap-2 text-gray-400">
        <Loader2 className="size-5 animate-spin" />
        <span className="text-sm">加载分子绘图引擎...</span>
      </div>
    ),
  }
);

// ─── 类型定义 ───

interface CompoundListItem {
  id: string;
  name: string;
  commonName?: string | null;
  casNumber?: string | null;
  smiles?: string | null;
  molecularFormula?: string | null;
  molecularWeight?: number | null;
  source: string;
  status: string;
  createdAt: string;
  createdById?: string | null;
  createdBy?: { id: string; name: string } | null;
  // 关联试剂（用于展示入库存量、存放位置、入库日、入库人）
  reagent?: {
    id: string;
    name: string;
    casNumber: string | null;
    stockQuantity: number;
    totalStockedBottles: number | null;
    unit: string | null;
    storageLocation: string | null;
    stockInDate: string | null;
    capacityPerUnit: number | null;
    capacityUnit: string | null;
    purity: string | null;
    stockInOperator?: { id: string; name: string } | null;
  } | null;
  _count?: {
    synthesisBatches: number;
    bioAssays: number;
    usageLogs: number;
    documents: number;
  };
}

interface ProjectOption {
  id: string;
  name: string;
  status: string;
}

interface SynthesisBatch {
  id: string;
  batchNumber: string;
  synthesizedAt: string;
  procedure: string;
  productMass?: number | null;
  yieldPercent?: number | null;
  purityPercent?: number | null;
  note?: string | null;
  operator?: { id: string; name: string } | null;
  _count?: { documents: number; bioAssays: number };
}

interface BioAssay {
  id: string;
  assayType: string;
  target?: string | null;
  result: string;
  resultSummary?: string | null;
  conclusion?: string | null;
  testedAt: string;
  testedBy?: { id: string; name: string } | null;
  batch?: { id: string; batchNumber: string } | null;
}

interface UsageLog {
  id: string;
  usageType: string;
  quantity: number;
  unit: string;
  purpose?: string | null;
  usedAt: string;
  usedBy?: { id: string; name: string } | null;
  note?: string | null;
}

interface CompoundDocument {
  id: string;
  docType: string;
  docSubtype?: string | null;
  fileUrl: string;
  fileName: string;
  note?: string | null;
  createdAt: string;
  uploadedBy?: { id: string; name: string } | null;
}

interface CompoundDetail extends CompoundListItem {
  physicochemical?: string | null;
  safetyInfo?: string | null;
  synthesisNote?: string | null;
  reagentId?: string | null;
  // `reagent` 字段继承自 CompoundListItem（含完整库存、存放位置、入库人等信息）
  synthesisBatches: SynthesisBatch[];
  bioAssays: BioAssay[];
  usageLogs: UsageLog[];
  documents: CompoundDocument[];
}

interface CompoundKnowledgeProps {
  /** 是否允许编辑（创建化合物、添加子资源） */
  canEdit: boolean;
  /** 是否为管理员（管理员可删除任意化合物，非管理员仅可删除自己创建的） */
  isAdmin?: boolean;
}

// ─── 常量 ───

const SOURCE_LABELS: Record<string, string> = {
  SYNTHESIZED: '自合成',
  PURCHASED: '购买',
  GIFT: '赠予',
  OTHER: '其他',
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: '在用', color: 'bg-emerald-100 text-emerald-700' },
  ARCHIVED: { label: '归档', color: 'bg-gray-100 text-gray-700' },
  DISPOSED: { label: '已处置', color: 'bg-red-100 text-red-700' },
};

const ASSAY_TYPE_LABELS: Record<string, string> = {
  ANTIBACTERIAL: '抑菌',
  ANTITUMOR: '抗肿瘤',
  ENZYME: '酶抑制',
  CYTOTOXICITY: '细胞毒性',
  ANTIOXIDANT: '抗氧化',
  OTHER: '其他',
};

const USAGE_TYPE_LABELS: Record<string, string> = {
  ASSAY: '测试',
  REQUISITION: '领用',
  TRANSFER: '转移',
  DISPOSAL: '处置',
  OTHER: '其他',
};

const DOC_TYPE_LABELS: Record<string, string> = {
  NMR: 'NMR',
  MS: '质谱',
  IR: '红外',
  UV: '紫外',
  HPLC: 'HPLC',
  GC: 'GC',
  MSDS: 'MSDS',
  PURITY_REPORT: '纯度报告',
  OTHER: '其他',
};

// ─── 站内结构式图片 URL：服务端 RDKit 优先、PubChem 降级 ───
function getCompoundStructureImageUrl(compound: CompoundListItem): string | null {
  if (!compound.smiles && !compound.casNumber) return null;
  return `/api/compounds/${encodeURIComponent(compound.id)}/structure`;
}

// ─── 化合物结构式图片组件（RDKit 优先 + PubChem 降级 + 懒加载 + 可点击大图）───
// 尺寸：size-[120px]（原 size-20=80px 的 1.5 倍），便于清晰查看分子结构
function CompoundStructureImage({
  compound,
  onStructureClick,
}: {
  compound: CompoundListItem;
  onStructureClick?: () => void;
}) {
  const [errored, setErrored] = useState(false);
  const url = getCompoundStructureImageUrl(compound);

  if (!url || errored) {
    return (
      <div className="flex size-[120px] items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-gray-300">
        <ImageOff className="size-8" />
      </div>
    );
  }

  if (onStructureClick) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onStructureClick();
        }}
        title="点击查看大图"
        className="group relative size-[120px] overflow-hidden rounded-lg border border-gray-200 bg-white transition-all hover:border-pink-300 hover:shadow-md"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={`${compound.name} 结构式`}
          title={compound.casNumber ? `CAS: ${compound.casNumber}` : compound.name}
          loading="lazy"
          className="size-full object-contain p-1"
          onError={() => setErrored(true)}
        />
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100">
          <ZoomIn className="size-7 text-white" />
        </span>
      </button>
    );
  }

  return (
    <div className="size-[120px] overflow-hidden rounded-lg border border-gray-200 bg-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={`${compound.name} 结构式`}
        title={compound.casNumber ? `CAS: ${compound.casNumber}` : compound.name}
        loading="lazy"
        className="size-full object-contain p-1"
        onError={() => setErrored(true)}
      />
    </div>
  );
}

// ─── 主组件 ───

export function CompoundKnowledge({ canEdit, isAdmin = false }: CompoundKnowledgeProps) {
  const [compounds, setCompounds] = useState<CompoundListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CompoundDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // SMILES 化学式查询相关状态
  const [smilesSearch, setSmilesSearch] = useState<string>('');
  const [smilesDrawerOpen, setSmilesDrawerOpen] = useState(false);
  const [activeSmilesFilter, setActiveSmilesFilter] = useState<{ smiles: string; mode: 'exact' | 'substructure' } | null>(null);

  // RDKit 子结构匹配
  const [rdkit, setRdkit] = useState<any>(null);
  const [rdkitLoading, setRdkitLoading] = useState(false);
  const [rdkitError, setRdkitError] = useState('');

  // 结构式大图
  const [enlargedImg, setEnlargedImg] = useState<{ url: string; name: string } | null>(null);

  // 加载列表（带 AbortController 防止旧请求覆盖新请求）
  const loadList = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      if (sourceFilter) params.set('source', sourceFilter);
      params.set('pageSize', '50');
      const res = await authFetch(`/api/compounds?${params.toString()}`, { signal });
      const data = await res.json();
      if (res.ok && data?.data) {
        setCompounds(data.data);
      } else {
        toast.error(data?.error || '加载失败');
      }
    } catch (err) {
      // AbortError 是预期行为（用户快速输入触发新请求），不报错
      if (err instanceof Error && err.name === 'AbortError') return;
      toast.error(err instanceof Error ? err.message : '网络错误');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, sourceFilter]);

  // debounce 300ms，避免输入触发频繁请求
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      loadList(controller.signal);
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [loadList]);

  // 精准/子结构搜索均需加载 RDKit WASM
  useEffect(() => {
    if (activeSmilesFilter && !rdkit && !rdkitLoading) {
      setRdkitLoading(true);
      setRdkitError('');
      loadRDKit().then(setRdkit).catch((e) => {
        console.error('RDKit load failed:', e);
        setRdkitError(e instanceof Error ? e.message : 'RDKit 加载失败');
      }).finally(() => setRdkitLoading(false));
    }
  }, [activeSmilesFilter, rdkit, rdkitLoading]);

  // RDKit 化学匹配过滤（精准=Canonical SMILES 比对，子结构=子图同构匹配）
  const filteredCompounds = useMemo(() => {
    if (!activeSmilesFilter || !rdkit || !activeSmilesFilter.smiles) return compounds;
    if (activeSmilesFilter.mode === 'exact') {
      return filterByExactMatch(rdkit, compounds, activeSmilesFilter.smiles, (c: CompoundListItem) => c.smiles);
    }
    return filterBySubstructure(rdkit, compounds, activeSmilesFilter.smiles, (c: CompoundListItem) => c.smiles);
  }, [compounds, activeSmilesFilter, rdkit]);

  // 化学式查询回调
  const handleSmilesSearch = (smiles: string, mode: 'exact' | 'substructure') => {
    setSmilesSearch(smiles);
    setActiveSmilesFilter({ smiles, mode });
    setSmilesDrawerOpen(false);
  };

  // 清除 SMILES 过滤
  const handleClearSmilesFilter = () => {
    setSmilesSearch('');
    setActiveSmilesFilter(null);
  };

  // 加载详情
  const loadDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    try {
      const res = await authFetch(`/api/compounds/${id}`);
      const data = await res.json();
      if (res.ok) {
        setDetail(data);
      } else {
        toast.error(data?.error || '加载详情失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '网络错误');
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    loadDetail(id);
  };

  const handleBack = () => {
    setSelectedId(null);
    setDetail(null);
  };

  const handleRefreshDetail = () => {
    if (selectedId) loadDetail(selectedId);
  };

  // 点击结构式查看大图
  const handleStructureClick = (compound: CompoundListItem) => {
    const url = getCompoundStructureImageUrl(compound);
    if (url) setEnlargedImg({ url, name: compound.name });
  };

  // 列表视图
  if (!selectedId) {
    return (
      <>
        <div className="space-y-4">
          {/* 批量导入对话框 */}
          <ImportDialog
            open={importOpen}
            onOpenChange={setImportOpen}
            title="批量导入化合物"
            templateUrl="/api/compounds/import"
            importUrl="/api/compounds/import"
            onImported={() => loadList()}
          />

          {/* 筛选条 */}
          <Card className="overflow-hidden border-gray-200 shadow-sm">
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  placeholder="搜索名称 / 通用名 / CAS 号"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9 w-56"
                  onKeyDown={(e) => e.key === 'Enter' && loadList()}
                />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">全部状态</option>
                  <option value="ACTIVE">在用</option>
                  <option value="ARCHIVED">归档</option>
                  <option value="DISPOSED">已处置</option>
                </select>
                <select
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">全部来源</option>
                  <option value="SYNTHESIZED">自合成</option>
                  <option value="PURCHASED">购买</option>
                  <option value="GIFT">赠予</option>
                  <option value="OTHER">其他</option>
                </select>
                {/* 化学式绘制查询按钮 */}
                <Button
                  variant="outline"
                  className="h-9"
                  onClick={() => setSmilesDrawerOpen(true)}
                >
                  <PenLine className="mr-1 size-4" />
                  化学式绘制查询
                </Button>
                {canEdit && (
                  <Button variant="outline" onClick={() => setShowCreateDialog(true)} className="h-9">
                    <Plus className="mr-1 size-4" />
                    新建化合物
                  </Button>
                )}
                <Button variant="outline" onClick={() => loadList()} disabled={loading} className="h-9">
                  {loading ? <Loader2 className="size-4 animate-spin" /> : '刷新'}
                </Button>
                {isAdmin && (
                  <Button variant="outline" onClick={() => setImportOpen(true)} className="h-9">
                    <Upload className="mr-1 size-4" />
                    批量导入
                  </Button>
                )}
              </div>

              {/* SMILES 过滤指示器 */}
              {activeSmilesFilter && (
                <div className="mt-2 flex items-center gap-2 rounded-md bg-cyan-50 px-3 py-1.5 text-xs text-cyan-700">
                  <Search className="size-3" />
                  <span>
                    {activeSmilesFilter.mode === 'exact' ? '精准查找' : '子结构查找'}：{activeSmilesFilter.smiles}
                  </span>
                  {rdkitLoading && <Loader2 className="size-3 animate-spin" />}
                  <button
                    type="button"
                    onClick={handleClearSmilesFilter}
                    className="ml-auto rounded p-0.5 hover:bg-cyan-100"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              )}
              {rdkitError && activeSmilesFilter && (
                <div className="mt-2 flex items-center gap-1 text-xs text-red-500">
                  <AlertCircle className="size-3" />
                  RDKit 加载失败：{rdkitError}，无法进行化学结构搜索
                </div>
              )}
            </CardContent>
          </Card>

          {/* 列表表格 */}
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredCompounds.length === 0 ? (
            <Card>
              <CardContent className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
                <FlaskRound className="size-12 opacity-30" />
                <p>{activeSmilesFilter ? '未找到匹配的化合物' : '暂无化合物记录'}</p>
                {canEdit && !activeSmilesFilter && (
                  <Button variant="outline" onClick={() => setShowCreateDialog(true)}>
                    <Plus className="mr-1 size-4" />
                    新建第一个化合物
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-hidden border-gray-200 shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-200 bg-gray-50/80">
                    <tr>
                      <th className="px-3 py-3.5 text-center whitespace-nowrap">结构式</th>
                      <th className="px-3 py-3.5 text-center whitespace-nowrap">名称</th>
                      <th className="px-3 py-3.5 text-center whitespace-nowrap">入库存量</th>
                      <th className="px-3 py-3.5 text-center whitespace-nowrap">存放位置</th>
                      <th className="px-3 py-3.5 text-center whitespace-nowrap">入库日</th>
                      <th className="px-3 py-3.5 text-center whitespace-nowrap">入库人</th>
                      <th className="px-3 py-3.5 text-center whitespace-nowrap">化学信息</th>
                      <th className="px-3 py-3.5 text-center whitespace-nowrap">生物信息</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredCompounds.map((c) => {
                      const status = STATUS_LABELS[c.status] ?? { label: c.status, color: 'bg-gray-100' };
                      const reagent = c.reagent;
                      const stockDisplay = reagent
                        ? getStockDisplayText({
                            stockQuantity: reagent.stockQuantity,
                            unit: reagent.unit,
                            capacityPerUnit: reagent.capacityPerUnit,
                            capacityUnit: reagent.capacityUnit,
                            totalStockedBottles: reagent.totalStockedBottles,
                          })
                        : null;
                      return (
                        <tr
                          key={c.id}
                          className="cursor-pointer hover:bg-gray-50/60 transition-colors"
                          onClick={() => handleSelect(c.id)}
                        >
                          {/* 结构式 */}
                          <td className="px-3 py-3 text-center">
                            <CompoundStructureImage
                              compound={c}
                              onStructureClick={() => handleStructureClick(c)}
                            />
                          </td>
                          {/* 名称 */}
                          <td className="px-3 py-3 text-center max-w-[160px]">
                            <div className="inline-flex flex-col items-center gap-0.5">
                              <span className="font-medium text-gray-900 break-all leading-snug">{c.name}</span>
                              {c.commonName && (
                                <span className="text-xs text-gray-500 truncate" title={c.commonName}>{c.commonName}</span>
                              )}
                              <div className="flex flex-wrap items-center justify-center gap-1">
                                <Badge className={cn('text-[10px] px-1.5 py-0', status.color)}>{status.label}</Badge>
                                {c.casNumber && (
                                  <span className="text-[10px] text-gray-400 font-mono">CAS: {c.casNumber}</span>
                                )}
                              </div>
                            </div>
                          </td>
                          {/* 入库存量 */}
                          <td className="px-3 py-3 text-center">
                            {stockDisplay ? (
                              <div className="inline-flex flex-col items-center gap-0.5">
                                <span className="font-semibold text-emerald-700">{stockDisplay.primary}</span>
                                {stockDisplay.secondary && (
                                  <span className="text-[10px] text-gray-400">{stockDisplay.secondary}</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-gray-400">未入库</span>
                            )}
                          </td>
                          {/* 存放位置 */}
                          <td className="px-3 py-3 text-center">
                            {reagent?.storageLocation ? (
                              <div className="inline-flex items-center gap-1 text-gray-600">
                                <MapPin className="size-3 text-gray-400" />
                                <span>{reagent.storageLocation}</span>
                              </div>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          {/* 入库日 */}
                          <td className="px-3 py-3 text-center text-gray-600 whitespace-nowrap">
                            {reagent?.stockInDate
                              ? new Date(reagent.stockInDate).toLocaleDateString('zh-CN')
                              : <span className="text-gray-400">-</span>}
                          </td>
                          {/* 入库人 */}
                          <td className="px-3 py-3 text-center text-gray-600">
                            {reagent?.stockInOperator?.name ?? <span className="text-gray-400">-</span>}
                          </td>
                          {/* 化学信息 */}
                          <td className="px-3 py-3 text-center">
                            <div className="inline-flex flex-col items-center gap-0.5">
                              {c._count && c._count.synthesisBatches > 0 ? (
                                <Badge variant="outline" className="text-[10px] border-amber-300 bg-amber-50 text-amber-700">
                                  <FlaskConical className="mr-0.5 size-2.5" />
                                  {c._count.synthesisBatches} 批次
                                </Badge>
                              ) : (
                                <span className="text-[10px] text-gray-400">无记录</span>
                              )}
                              {c._count && c._count.documents > 0 && (
                                <Badge variant="outline" className="text-[10px] text-gray-500">
                                  <FileText className="mr-0.5 size-2.5" />
                                  {c._count.documents} 文档
                                </Badge>
                              )}
                            </div>
                          </td>
                          {/* 生物信息 */}
                          <td className="px-3 py-3 text-center">
                            {c._count && c._count.bioAssays > 0 ? (
                              <Badge variant="outline" className="text-[10px] border-emerald-300 bg-emerald-50 text-emerald-700">
                                <Activity className="mr-0.5 size-2.5" />
                                {c._count.bioAssays} 测试
                              </Badge>
                            ) : (
                              <span className="text-[10px] text-gray-400">无记录</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>

        {/* 结构式大图弹窗 */}
        {enlargedImg && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setEnlargedImg(null)}
          >
            <div className="relative max-h-[90vh] max-w-2xl" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => setEnlargedImg(null)}
                className="absolute -right-3 -top-3 z-10 rounded-full bg-white p-1.5 shadow-lg hover:bg-gray-100"
              >
                <X className="size-5 text-gray-600" />
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={enlargedImg.url}
                alt={`${enlargedImg.name} 结构式`}
                className="max-h-[85vh] rounded-lg bg-white shadow-2xl"
              />
              <p className="mt-2 text-center text-sm text-white/80">{enlargedImg.name}</p>
            </div>
          </div>
        )}

        <CompoundCreateDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          onCreated={(newCompound) => {
            setShowCreateDialog(false);
            loadList();
            handleSelect(newCompound.id);
          }}
        />

        {/* 化学式绘制查询弹窗 */}
        <SmilesDrawerModal
          open={smilesDrawerOpen}
          onClose={() => setSmilesDrawerOpen(false)}
          onSearch={handleSmilesSearch}
          initialSmiles={smilesSearch}
          title="化学式查询化合物"
        />
      </>
    );
  }

  // 详情视图
  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={handleBack} className="mb-2">
        <ArrowLeft className="mr-1 size-4" />
        返回列表
      </Button>

      {loadingDetail || !detail ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <CompoundDetailPanel
          detail={detail}
          canEdit={canEdit}
          isAdmin={isAdmin}
          onRefresh={handleRefreshDetail}
          onDelete={async () => {
            if (!confirm(`确认删除化合物「${detail.name}」？所有相关批次/测试/文档将一并删除。`)) return;
            try {
              const res = await authFetch(`/api/compounds/${detail.id}`, { method: 'DELETE' });
              if (res.ok) {
                toast.success('已删除');
                handleBack();
                loadList();
              } else {
                const data = await res.json().catch(() => ({}));
                toast.error(data.error || '删除失败');
              }
            } catch (err) {
              toast.error(err instanceof Error ? err.message : '网络错误');
            }
          }}
        />
      )}
    </div>
  );
}

// ─── 详情面板 ───

function CompoundDetailPanel({
  detail,
  canEdit,
  isAdmin,
  onRefresh,
  onDelete,
}: {
  detail: CompoundDetail;
  canEdit: boolean;
  isAdmin: boolean;
  onRefresh: () => void;
  onDelete: () => void;
}) {
  const status = STATUS_LABELS[detail.status] ?? { label: detail.status, color: 'bg-gray-100' };
  const [showBatchForm, setShowBatchForm] = useState(false);
  const [showAssayForm, setShowAssayForm] = useState(false);
  const [showUsageForm, setShowUsageForm] = useState(false);
  const [showDocForm, setShowDocForm] = useState(false);
  const currentUser = useAuthStore((s) => s.user);

  // 删除权限：管理员可删除任意化合物，实验员仅可删除自己创建的
  const canDelete = canEdit && (isAdmin || detail.createdById === currentUser?.id);

  // 化学合成摘要
  const synthesisSummary = useMemo(() => {
    const batches = detail.synthesisBatches ?? [];
    if (batches.length === 0) return null;
    const latest = batches[0];
    const totalMass = batches.reduce((sum, b) => sum + (b.productMass ?? 0), 0);
    const avgYield = batches.filter((b) => b.yieldPercent != null).reduce((sum, b, _, arr) => sum + (b.yieldPercent ?? 0) / arr.length, 0);
    return {
      batchCount: batches.length,
      latestDate: latest?.synthesizedAt,
      totalMass: totalMass > 0 ? `${totalMass.toFixed(2)} g` : null,
      avgYield: avgYield > 0 ? `${avgYield.toFixed(1)}%` : null,
    };
  }, [detail.synthesisBatches]);

  // 生物评价摘要
  const bioAssaySummary = useMemo(() => {
    const assays = detail.bioAssays ?? [];
    if (assays.length === 0) return null;
    const latest = assays[0];
    // 按测试类型分组统计
    const typeCount: Record<string, number> = {};
    for (const a of assays) {
      const label = ASSAY_TYPE_LABELS[a.assayType] ?? a.assayType;
      typeCount[label] = (typeCount[label] || 0) + 1;
    }
    return {
      assayCount: assays.length,
      latestDate: latest?.testedAt,
      typeCount,
      highlights: assays.map((a) => a.resultSummary).filter(Boolean).slice(0, 3),
    };
  }, [detail.bioAssays]);

  return (
    <div className="space-y-4">
      {/* 基本信息卡片 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                {detail.name}
                <Badge className={status.color}>{status.label}</Badge>
                <Badge variant="outline">{SOURCE_LABELS[detail.source] ?? detail.source}</Badge>
              </CardTitle>
              {detail.commonName && (
                <p className="mt-1 text-sm text-muted-foreground">通用名: {detail.commonName}</p>
              )}
            </div>
            {canDelete && (
              <Button variant="destructive" size="sm" onClick={onDelete}>
                <Trash2 className="mr-1 size-4" />
                删除
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <InfoCell label="CAS 号" value={detail.casNumber} />
            <InfoCell label="分子式" value={detail.molecularFormula} />
            <InfoCell label="分子量" value={detail.molecularWeight ? `${detail.molecularWeight} g/mol` : null} />
            <InfoCell
              label="创建人"
              value={detail.createdBy?.name}
            />
          </div>
          {detail.smiles && (
            <div className="mt-3">
              <Label className="text-xs text-muted-foreground">SMILES</Label>
              <code className="mt-1 block break-all rounded bg-muted px-2 py-1 text-xs">{detail.smiles}</code>
            </div>
          )}
          {detail.reagent && (
            <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-2 text-xs">
              <span className="font-medium text-blue-800">关联试剂:</span>{' '}
              <span className="text-blue-700">{detail.reagent.name}</span>
              {detail.reagent.casNumber && <span className="text-blue-600"> (CAS: {detail.reagent.casNumber})</span>}
              {(() => {
                const stock = getStockDisplayText({
                  stockQuantity: detail.reagent.stockQuantity,
                  unit: detail.reagent.unit,
                  capacityPerUnit: detail.reagent.capacityPerUnit,
                  capacityUnit: detail.reagent.capacityUnit,
                  totalStockedBottles: detail.reagent.totalStockedBottles,
                });
                return (
                  <span className="ml-2 text-blue-600">
                    库存: {stock.primary}
                    {stock.secondary && <span className="ml-1 text-blue-500/80">（{stock.secondary}）</span>}
                  </span>
                );
              })()}
              {detail.reagent.storageLocation && (
                <span className="ml-2 inline-flex items-center gap-0.5 text-blue-600">
                  <MapPin className="size-3" />
                  {detail.reagent.storageLocation}
                </span>
              )}
              {detail.reagent.stockInOperator?.name && (
                <span className="ml-2 text-blue-500/80">
                  入库人: {detail.reagent.stockInOperator.name}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 两大属性摘要：化学合成 / 生物评价 */}
      <div className="grid gap-3 md:grid-cols-2">
        {/* 化学合成摘要 */}
        <Card className="border-amber-200 bg-gradient-to-br from-amber-50/50 to-orange-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="flex size-7 items-center justify-center rounded-lg bg-amber-100">
                <Beaker className="size-4 text-amber-600" />
              </div>
              化学合成
              {synthesisSummary && (
                <Badge variant="outline" className="ml-auto text-xs">
                  {synthesisSummary.batchCount} 个批次
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {synthesisSummary ? (
              <div className="space-y-1.5 text-xs">
                {synthesisSummary.latestDate && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span>最近合成：</span>
                    <span className="font-medium text-foreground">
                      {new Date(synthesisSummary.latestDate).toLocaleDateString('zh-CN')}
                    </span>
                  </div>
                )}
                {synthesisSummary.totalMass && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span>累计产物：</span>
                    <span className="font-medium text-foreground">{synthesisSummary.totalMass}</span>
                  </div>
                )}
                {synthesisSummary.avgYield && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span>平均收率：</span>
                    <span className="font-medium text-foreground">{synthesisSummary.avgYield}</span>
                  </div>
                )}
                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 h-7 border-amber-300 text-xs text-amber-700 hover:bg-amber-100"
                    onClick={() => setShowBatchForm(true)}
                  >
                    <Plus className="mr-1 size-3" />
                    添加合成批次
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2 text-xs text-muted-foreground">
                <p>暂无合成记录</p>
                {detail.synthesisNote && (
                  <div className="rounded bg-amber-50/80 p-2 text-xs">
                    <span className="font-medium text-amber-800">方法摘要：</span>
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap">{detail.synthesisNote}</p>
                  </div>
                )}
                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 border-amber-300 text-xs text-amber-700 hover:bg-amber-100"
                    onClick={() => setShowBatchForm(true)}
                  >
                    <Plus className="mr-1 size-3" />
                    添加合成批次
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 生物评价摘要 */}
        <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/50 to-teal-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-100">
                <Microscope className="size-4 text-emerald-600" />
              </div>
              生物评价
              {bioAssaySummary && (
                <Badge variant="outline" className="ml-auto text-xs">
                  {bioAssaySummary.assayCount} 项测试
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {bioAssaySummary ? (
              <div className="space-y-1.5 text-xs">
                {bioAssaySummary.latestDate && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span>最近测试：</span>
                    <span className="font-medium text-foreground">
                      {new Date(bioAssaySummary.latestDate).toLocaleDateString('zh-CN')}
                    </span>
                  </div>
                )}
                <div className="flex flex-wrap gap-1">
                  {Object.entries(bioAssaySummary.typeCount).map(([type, count]) => (
                    <Badge key={type} variant="secondary" className="text-[10px]">
                      {type} ×{count}
                    </Badge>
                  ))}
                </div>
                {bioAssaySummary.highlights.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {bioAssaySummary.highlights.map((h, i) => (
                      <p key={i} className="line-clamp-1 text-emerald-700">• {h}</p>
                    ))}
                  </div>
                )}
                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 h-7 border-emerald-300 text-xs text-emerald-700 hover:bg-emerald-100"
                    onClick={() => setShowAssayForm(true)}
                  >
                    <Plus className="mr-1 size-3" />
                    添加生物活性测试
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2 text-xs text-muted-foreground">
                <p>暂无生物评价记录</p>
                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 border-emerald-300 text-xs text-emerald-700 hover:bg-emerald-100"
                    onClick={() => setShowAssayForm(true)}
                  >
                    <Plus className="mr-1 size-3" />
                    添加生物活性测试
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 子资源 Tab（完整记录） */}
      <Tabs defaultValue="batches">
        <TabsList>
          <TabsTrigger value="batches">
            <FlaskConical className="mr-1 size-4" />
            合成批次 ({detail.synthesisBatches.length})
          </TabsTrigger>
          <TabsTrigger value="bioassays">
            <Activity className="mr-1 size-4" />
            生物活性 ({detail.bioAssays.length})
          </TabsTrigger>
          <TabsTrigger value="usage">
            <History className="mr-1 size-4" />
            使用记录 ({detail.usageLogs.length})
          </TabsTrigger>
          <TabsTrigger value="docs">
            <FileText className="mr-1 size-4" />
            表征文档 ({detail.documents.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="batches">
          <BatchList batches={detail.synthesisBatches} />
          {canEdit && (
            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={() => setShowBatchForm(true)}>
                <Plus className="mr-1 size-4" />
                添加合成批次
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="bioassays">
          <AssayList assays={detail.bioAssays} />
          {canEdit && (
            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={() => setShowAssayForm(true)}>
                <Plus className="mr-1 size-4" />
                添加生物活性测试
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="usage">
          <UsageList logs={detail.usageLogs} />
          {canEdit && (
            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={() => setShowUsageForm(true)}>
                <Plus className="mr-1 size-4" />
                添加使用记录
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="docs">
          <DocList docs={detail.documents} />
          {canEdit && (
            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={() => setShowDocForm(true)}>
                <Plus className="mr-1 size-4" />
                添加文档
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* 表单 Dialogs */}
      <BatchFormDialog
        open={showBatchForm}
        onOpenChange={setShowBatchForm}
        compoundId={detail.id}
        onSaved={() => {
          setShowBatchForm(false);
          onRefresh();
        }}
      />
      <AssayFormDialog
        open={showAssayForm}
        onOpenChange={setShowAssayForm}
        compoundId={detail.id}
        batches={detail.synthesisBatches}
        onSaved={() => {
          setShowAssayForm(false);
          onRefresh();
        }}
      />
      <UsageFormDialog
        open={showUsageForm}
        onOpenChange={setShowUsageForm}
        compoundId={detail.id}
        onSaved={() => {
          setShowUsageForm(false);
          onRefresh();
        }}
      />
      <DocFormDialog
        open={showDocForm}
        onOpenChange={setShowDocForm}
        compoundId={detail.id}
        batches={detail.synthesisBatches}
        onSaved={() => {
          setShowDocForm(false);
          onRefresh();
        }}
      />
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <p className="mt-0.5 text-sm">{value ?? '—'}</p>
    </div>
  );
}

// ─── 子资源列表组件 ───

function BatchList({ batches }: { batches: SynthesisBatch[] }) {
  if (batches.length === 0) {
    return <EmptyHint text="暂无合成批次记录" />;
  }
  return (
    <div className="space-y-2">
      {batches.map((b) => (
        <Card key={b.id}>
          <CardContent className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{b.batchNumber}</span>
                  <Badge variant="outline" className="text-xs">
                    {new Date(b.synthesizedAt).toLocaleDateString('zh-CN')}
                  </Badge>
                </div>
                {b.operator && (
                  <p className="mt-0.5 text-xs text-muted-foreground">操作人: {b.operator.name}</p>
                )}
              </div>
              <div className="flex gap-2 text-xs text-muted-foreground">
                {b.yieldPercent != null && <span>收率 {b.yieldPercent}%</span>}
                {b.purityPercent != null && <span>纯度 {b.purityPercent}%</span>}
                {b.productMass != null && <span>{b.productMass} g</span>}
              </div>
            </div>
            <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
              {b.procedure}
            </p>
            {b.note && <p className="mt-1 text-xs italic text-muted-foreground">备注: {b.note}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function AssayList({ assays }: { assays: BioAssay[] }) {
  if (assays.length === 0) {
    return <EmptyHint text="暂无生物活性测试记录" />;
  }
  return (
    <div className="space-y-2">
      {assays.map((a) => (
        <Card key={a.id}>
          <CardContent className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {ASSAY_TYPE_LABELS[a.assayType] ?? a.assayType}
                  </Badge>
                  {a.target && <span className="text-sm font-medium">{a.target}</span>}
                  {a.batch && (
                    <Badge variant="secondary" className="text-xs">
                      批次 {a.batch.batchNumber}
                    </Badge>
                  )}
                </div>
                {a.resultSummary && (
                  <p className="mt-1 text-sm font-medium text-emerald-700">{a.resultSummary}</p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  测试时间: {new Date(a.testedAt).toLocaleDateString('zh-CN')}
                  {a.testedBy && ` · ${a.testedBy.name}`}
                </p>
              </div>
            </div>
            {a.conclusion && (
              <p className="mt-2 text-xs text-muted-foreground">结论: {a.conclusion}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function UsageList({ logs }: { logs: UsageLog[] }) {
  if (logs.length === 0) {
    return <EmptyHint text="暂无使用记录" />;
  }
  return (
    <div className="space-y-2">
      {logs.map((l) => (
        <Card key={l.id}>
          <CardContent className="p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {USAGE_TYPE_LABELS[l.usageType] ?? l.usageType}
                  </Badge>
                  <span className="font-medium">
                    {l.quantity} {l.unit}
                  </span>
                </div>
                {l.purpose && <p className="mt-1 text-xs text-muted-foreground">目的: {l.purpose}</p>}
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(l.usedAt).toLocaleDateString('zh-CN')}
                  {l.usedBy && ` · ${l.usedBy.name}`}
                </p>
              </div>
              {l.note && <p className="text-xs italic text-muted-foreground">{l.note}</p>}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function DocList({ docs }: { docs: CompoundDocument[] }) {
  if (docs.length === 0) {
    return <EmptyHint text="暂无文档" />;
  }
  return (
    <div className="space-y-2">
      {docs.map((d) => (
        <Card key={d.id}>
          <CardContent className="p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {DOC_TYPE_LABELS[d.docType] ?? d.docType}
                </Badge>
                {d.docSubtype && <span className="text-xs text-muted-foreground">{d.docSubtype}</span>}
                <a
                  href={d.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-1 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
                >
                  {d.fileName}
                  <ExternalLink className="size-3" />
                </a>
              </div>
              <span className="text-xs text-muted-foreground">
                {new Date(d.createdAt).toLocaleDateString('zh-CN')}
                {d.uploadedBy && ` · ${d.uploadedBy.name}`}
              </span>
            </div>
            {d.note && <p className="mt-1 text-xs text-muted-foreground">{d.note}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

// ─── 表单 Dialogs ───

function CompoundCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (c: CompoundListItem) => void;
}) {
  const [form, setForm] = useState({
    name: '',
    commonName: '',
    casNumber: '',
    smiles: '',
    molecularFormula: '',
    molecularWeight: '',
    synthesisNote: '',
    projectId: '',
    source: 'SYNTHESIZED',
    // 入库信息
    stockQuantity: '',
    stockUnit: 'mg',
    purity: '',
    storageLocation: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  // 当前登录用户（用于自动填入"入库人"）
  const currentUser = useAuthStore((s) => s.user);
  // 跟踪分子式/分子量是否由 SMILES 自动计算填入（用户手动修改后清除标记）
  const [autoFilled, setAutoFilled] = useState<{ formula: boolean; weight: boolean }>({
    formula: false,
    weight: false,
  });
  const [computing, setComputing] = useState(false);
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [projectLoadError, setProjectLoadError] = useState('');

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoadingProjects(true);
    setProjectLoadError('');
    authFetch('/api/projects', { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '课题列表加载失败');
        setProjectOptions(Array.isArray(result.data) ? result.data : []);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setProjectOptions([]);
        setProjectLoadError(error instanceof Error ? error.message : '课题列表加载失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingProjects(false);
      });
    return () => controller.abort();
  }, [open]);

  // 从 SMILES 自动计算分子式和分子量（使用 RDKit WASM）
  const computeMolInfo = useCallback(async (smiles: string, force = false) => {
    const trimmed = smiles.trim();
    if (!trimmed) {
      setForm((f) => ({
        ...f,
        molecularFormula: autoFilled.formula ? '' : f.molecularFormula,
        molecularWeight: autoFilled.weight ? '' : f.molecularWeight,
      }));
      setAutoFilled({ formula: false, weight: false });
      return;
    }
    setComputing(true);
    try {
      const rdkit = await loadRDKit();
      const info = getMolInfo(rdkit, trimmed);
      if (info && info.formula && info.molecularWeight != null) {
        setForm((f) => ({
          ...f,
          molecularFormula: force || autoFilled.formula || !f.molecularFormula ? info.formula! : f.molecularFormula,
          molecularWeight: force || autoFilled.weight || !f.molecularWeight
            ? String(Math.round(info.molecularWeight! * 100) / 100)
            : f.molecularWeight,
        }));
        setAutoFilled({ formula: true, weight: true });
        if (force) toast.success('分子式和分子量已计算');
      } else {
        toast.error('无法解析该 SMILES，请检查格式');
      }
    } catch (e) {
      console.warn('[CompoundCreate] RDKit 加载失败:', e);
      toast.error(e instanceof Error ? e.message : '分子计算引擎加载失败，请重试');
    } finally {
      setComputing(false);
    }
  }, [autoFilled.formula, autoFilled.weight]);

  // 绘图器返回 SMILES 后立即计算
  const handleDrawerConfirm = (smiles: string) => {
    setForm((f) => ({ ...f, smiles }));
    void computeMolInfo(smiles, true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error('请填写化合物名称');
      return;
    }
    if (!form.smiles.trim()) {
      toast.error('请填写 SMILES 或点击「绘制分子结构」生成');
      return;
    }
    if (!form.projectId) {
      toast.error('请选择关联课题');
      return;
    }
    const stockQty = Number(form.stockQuantity);
    if (!form.stockQuantity.trim() || isNaN(stockQty) || stockQty <= 0) {
      toast.error('请填写有效的入库存量（正数）');
      return;
    }
    if (!form.storageLocation.trim()) {
      toast.error('请填写存放位置');
      return;
    }
    setSubmitting(true);
    try {
      const res = await authFetch('/api/compounds', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          commonName: form.commonName.trim() || undefined,
          casNumber: form.casNumber.trim() || undefined,
          smiles: form.smiles.trim(),
          molecularFormula: form.molecularFormula.trim() || undefined,
          molecularWeight: form.molecularWeight ? Number(form.molecularWeight) : undefined,
          synthesisNote: form.synthesisNote.trim() || undefined,
          projectId: form.projectId,
          source: form.source,
          // 入库信息
          stockQuantity: stockQty,
          stockUnit: form.stockUnit,
          purity: form.purity.trim() || undefined,
          storageLocation: form.storageLocation.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('创建成功');
        setForm({
          name: '',
          commonName: '',
          casNumber: '',
          smiles: '',
          molecularFormula: '',
          molecularWeight: '',
          synthesisNote: '',
          projectId: '',
          source: 'SYNTHESIZED',
          stockQuantity: '',
          stockUnit: 'mg',
          purity: '',
          storageLocation: '',
        });
        setAutoFilled({ formula: false, weight: false });
        onCreated(data);
      } else {
        toast.error(data.error || '创建失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '网络错误');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>新建化合物</DialogTitle>
        </DialogHeader>
        {/* 移动端单列，sm+ 双列 */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="compound-name" className="block">
              化合物名称 *
            </Label>
            <Input
              id="compound-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="如 XY-001"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="common-name" className="block">
              通用名 / IUPAC
            </Label>
            <Input
              id="common-name"
              value={form.commonName}
              onChange={(e) => setForm({ ...form, commonName: e.target.value })}
              placeholder="如 Aspirin"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cas-number" className="block">
              CAS 号
            </Label>
            <Input
              id="cas-number"
              value={form.casNumber}
              onChange={(e) => setForm({ ...form, casNumber: e.target.value })}
            />
          </div>
          {/* SMILES：必填，附「绘制分子结构」入口 */}
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <Label>SMILES *</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setShowDrawer(true)}
              >
                <PenLine className="size-3" />
                绘制分子结构
              </Button>
            </div>
            <Input
              value={form.smiles}
              onChange={(e) => {
                const smiles = e.target.value;
                setForm((current) => ({
                  ...current,
                  smiles,
                  molecularFormula: autoFilled.formula ? '' : current.molecularFormula,
                  molecularWeight: autoFilled.weight ? '' : current.molecularWeight,
                }));
                setAutoFilled({ formula: false, weight: false });
              }}
              placeholder="如 CC(=O)OC1=CC=CC=C1C(=O)O，或点击右侧绘制"
              className="font-mono text-sm"
            />
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1 text-xs text-gray-400">
                {computing ? <><Loader2 className="size-3 animate-spin" />正在计算分子式与分子量...</> : '输入或绘制 SMILES 后，可自动计算下方信息'}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={computing || !form.smiles.trim()}
                onClick={() => void computeMolInfo(form.smiles, true)}
              >
                {computing ? <Loader2 className="size-3 animate-spin" /> : <Calculator className="size-3" />}
                自动计算分子式与分子量
              </Button>
            </div>
          </div>
          <div>
            <Label className="flex items-center gap-1">
              分子式
              {autoFilled.formula && (
                <span className="rounded bg-teal-50 px-1 text-[10px] text-teal-600">自动</span>
              )}
            </Label>
            <Input
              value={form.molecularFormula}
              onChange={(e) => {
                setForm({ ...form, molecularFormula: e.target.value });
                setAutoFilled((a) => ({ ...a, formula: false }));
              }}
              placeholder="如 C9H8O4（由 SMILES 自动计算）"
            />
          </div>
          <div>
            <Label className="flex items-center gap-1">
              分子量 (g/mol)
              {autoFilled.weight && (
                <span className="rounded bg-teal-50 px-1 text-[10px] text-teal-600">自动</span>
              )}
            </Label>
            <Input
              type="number"
              value={form.molecularWeight}
              onChange={(e) => {
                setForm({ ...form, molecularWeight: e.target.value });
                setAutoFilled((a) => ({ ...a, weight: false }));
              }}
              placeholder="如 180.16（由 SMILES 自动计算）"
            />
          </div>
          <div>
            <Label>来源</Label>
            <select
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="SYNTHESIZED">自合成</option>
              <option value="PURCHASED">购买</option>
              <option value="GIFT">赠予</option>
              <option value="OTHER">其他</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <Label>关联课题 *</Label>
            <select
              value={form.projectId}
              onChange={(e) => setForm({ ...form, projectId: e.target.value })}
              disabled={loadingProjects || projectOptions.length === 0}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">
                {loadingProjects
                  ? '正在加载课题...'
                  : projectOptions.length === 0
                    ? '当前实验室暂无可关联课题'
                    : '请选择关联课题'}
              </option>
              {projectOptions.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
            {projectLoadError ? (
              <p className="mt-1 text-xs text-rose-500">{projectLoadError}</p>
            ) : (
              <p className="mt-1 text-xs text-gray-400">创建成功后，化合物会同步出现在所选课题的关联化合物中。</p>
            )}
          </div>
          <div className="sm:col-span-2">
            <Label>方法摘要(如关联课题文献应填写附件名词)</Label>
            <Textarea
              value={form.synthesisNote}
              onChange={(e) => setForm({ ...form, synthesisNote: e.target.value })}
              rows={3}
              placeholder="简要描述实验或合成方法；如引用关联课题文献，请填写对应附件名词"
            />
          </div>

          {/* ── 入库信息 ── */}
          <div className="sm:col-span-2 mt-2 border-t border-gray-100 pt-3">
            <p className="mb-2 flex items-center gap-1 text-xs font-medium text-gray-500">
              <Package className="size-3" />
              入库信息（创建时自动建立关联试剂）
            </p>
          </div>
          {/* 入库存量：数值 + 单位 */}
          <div>
            <Label>入库存量（数值）*</Label>
            <Input
              type="number"
              value={form.stockQuantity}
              onChange={(e) => setForm({ ...form, stockQuantity: e.target.value })}
              placeholder="如 10"
              step="any"
              min="0"
            />
          </div>
          <div>
            <Label>单位 *</Label>
            <select
              value={form.stockUnit}
              onChange={(e) => setForm({ ...form, stockUnit: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="mg">mg</option>
              <option value="g">g</option>
              <option value="kg">kg</option>
              <option value="mL">mL</option>
              <option value="L">L</option>
              <option value="μmol">μmol</option>
              <option value="mmol">mmol</option>
            </select>
          </div>
          {/* 纯度 */}
          <div>
            <Label>纯度</Label>
            <Input
              value={form.purity}
              onChange={(e) => setForm({ ...form, purity: e.target.value })}
              placeholder="如 98%（可选）"
            />
          </div>
          {/* 存放位置 */}
          <div>
            <Label>存放位置 *</Label>
            <Input
              value={form.storageLocation}
              onChange={(e) => setForm({ ...form, storageLocation: e.target.value })}
              placeholder="如 试剂柜 A-1"
            />
          </div>
          {/* 入库日 + 入库人：自动填入，只读展示 */}
          <div>
            <Label className="flex items-center gap-1">
              入库日
              <span className="rounded bg-teal-50 px-1 text-[10px] text-teal-600">自动</span>
            </Label>
            <Input
              value={new Date().toLocaleDateString('zh-CN')}
              readOnly
              className="bg-gray-50 text-gray-500"
            />
          </div>
          <div>
            <Label className="flex items-center gap-1">
              入库人
              <span className="rounded bg-teal-50 px-1 text-[10px] text-teal-600">自动</span>
            </Label>
            <Input
              value={currentUser?.name || '当前登录用户'}
              readOnly
              className="bg-gray-50 text-gray-500"
            />
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting} className="w-full sm:w-auto">
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting} className="w-full sm:w-auto">
            {submitting ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* 分子结构绘图器 */}
      <CompoundSmilesDrawerModal
        open={showDrawer}
        onClose={() => setShowDrawer(false)}
        onConfirm={handleDrawerConfirm}
        initialSmiles={form.smiles}
      />
    </Dialog>
  );
}

// ─── 分子结构绘图器 Modal（新建化合物用） ───

const QUICK_SMILES = [
  { label: '苯环', value: 'c1ccccc1' },
  { label: '乙醇', value: 'CCO' },
  { label: '乙酸', value: 'CC(=O)O' },
  { label: '丙酮', value: 'CC(=O)C' },
  { label: '水', value: 'O' },
  { label: '甲烷', value: 'C' },
];

function CompoundSmilesDrawerModal({
  open,
  onClose,
  onConfirm,
  initialSmiles = '',
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (smiles: string) => void;
  initialSmiles?: string;
}) {
  const [smilesInput, setSmilesInput] = useState(initialSmiles);
  const [error, setError] = useState<string | null>(null);
  const [ketcherReady, setKetcherReady] = useState(false);
  const [busyAction, setBusyAction] = useState<'load' | 'get' | 'confirm' | null>(null);
  const [hasOpened, setHasOpened] = useState(open);
  const ketcherRef = useRef<KetcherApi | null>(null);

  // 打开时重置输入
  useEffect(() => {
    if (open) {
      setHasOpened(true);
      setSmilesInput(initialSmiles);
      setError(null);
    }
  }, [open, initialSmiles]);

  const handleKetcherInit = useCallback(
    (ketcher: KetcherApi) => {
      ketcherRef.current = ketcher;
      setKetcherReady(true);
      setError(null);
      if (initialSmiles) {
        runKetcherOperation(() => ketcher.setMolecule(initialSmiles)).catch(() => {});
      }
    },
    [initialSmiles]
  );

  const handleKetcherError = useCallback((msg: string) => {
    setError('绘图引擎错误: ' + msg);
  }, []);

  const getSmilesFromCanvas = async (): Promise<string | null> => {
    if (!ketcherRef.current) return null;
    const smiles = await getStandardSmiles(ketcherRef.current);
    return smiles?.trim() || null;
  };

  const handleLoadToCanvas = async () => {
    const ketcher = ketcherRef.current;
    if (!ketcher || !smilesInput.trim()) return;
    setBusyAction('load');
    setError(null);
    try {
      await runKetcherOperation(() => ketcher.setMolecule(smilesInput.trim()));
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'SMILES 解析失败，请检查格式');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSyncFromCanvas = async () => {
    setBusyAction('get');
    setError(null);
    try {
      const smiles = await getSmilesFromCanvas();
      if (smiles) {
        setSmilesInput(smiles);
      } else {
        setError('画布为空，请先绘制分子结构');
      }
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : '无法从画布读取结构，请重试');
    } finally {
      setBusyAction(null);
    }
  };

  const handleClear = async () => {
    setSmilesInput('');
    setError(null);
    const ketcher = ketcherRef.current;
    if (ketcher) {
      try {
        await runKetcherOperation(() => ketcher.clear());
      } catch {}
    }
  };

  const handleConfirm = async () => {
    if (busyAction) return;
    setBusyAction('confirm');
    setError(null);
    // 输入框有值时直接确认；仅在输入为空时读取画布，避免确认按钮被慢操作拖住。
    let finalSmiles = smilesInput.trim();
    try {
      if (!finalSmiles && ketcherReady) {
        try {
          const canvasSmiles = await getSmilesFromCanvas();
          if (canvasSmiles) finalSmiles = canvasSmiles;
        } catch {
          // 画布读取超时时仍允许直接使用输入框内容。
        }
      }
      if (!finalSmiles) {
        setError('请绘制分子结构或输入 SMILES 字符串');
        return;
      }
      onConfirm(finalSmiles);
      onClose();
    } finally {
      setBusyAction(null);
    }
  };

  const submitConfirm = () => {
    if (busyAction) return;
    const typedSmiles = smilesInput.trim();
    if (typedSmiles) {
      setError(null);
      onConfirm(typedSmiles);
      onClose();
      return;
    }
    void handleConfirm();
  };

  if (!hasOpened) return null;

  return (
    <div className={cn('fixed inset-0 z-[80] items-center justify-center bg-black/50 p-2 sm:p-4', open ? 'flex' : 'hidden')}>
      <div className="flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-pink-500 to-rose-600 text-white">
              <PenLine className="size-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900 sm:text-base">绘制分子结构</h3>
              <p className="text-[11px] text-gray-500 sm:text-xs">绘制或输入 SMILES 后点击「确认使用」</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">
          {/* 移动端单列，lg+ 双列（绘图器 + 控制面板） */}
          <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-700">分子结构绘图器</label>
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <KetcherEditor onInit={handleKetcherInit} onError={handleKetcherError} />
              </div>
              <p className="mt-1.5 text-[11px] text-gray-400">
                使用上方工具栏绘制分子结构，或在右侧输入 SMILES 后点击「加载到画布」
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-700">SMILES 字符串</label>
                <Input
                  value={smilesInput}
                  onChange={(e) => setSmilesInput(e.target.value)}
                  placeholder="如 CCO、c1ccccc1"
                  className="font-mono text-sm"
                />
                <div className="mt-1.5 flex gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 flex-1 text-xs"
                    onClick={handleLoadToCanvas}
                    disabled={!smilesInput.trim() || !ketcherReady || busyAction !== null}
                  >
                    {busyAction === 'load' ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />} 加载到画布
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 flex-1 text-xs"
                    onClick={handleSyncFromCanvas}
                    disabled={!ketcherReady || busyAction !== null}
                  >
                    {busyAction === 'get' ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />} 从画布获取
                  </Button>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-700">快捷示例</label>
                <div className="flex flex-wrap gap-1">
                  {QUICK_SMILES.map((q) => (
                    <button
                      key={q.label}
                      type="button"
                      onClick={() => setSmilesInput(q.value)}
                      className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-700 transition-all hover:border-pink-300 hover:bg-pink-50 hover:text-pink-700"
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>

              <Button variant="ghost" size="sm" className="w-full text-xs text-gray-500" onClick={handleClear}>
                清空画布与输入
              </Button>

              {error && (
                <p className="flex items-center gap-1 text-xs text-red-500">
                  <AlertCircle className="size-3 shrink-0" />
                  {error}
                </p>
              )}
            </div>
          </div>
        </div>

        <form
          className="flex shrink-0 justify-end gap-2 border-t border-gray-100 px-4 py-3 sm:px-5"
          onSubmit={(event) => {
            event.preventDefault();
            submitConfirm();
          }}
        >
          <Button variant="outline" size="sm" onClick={onClose} className={cn('h-9')}>
            取消
          </Button>
          <Button
            size="sm"
            htmlType="submit"
            onClick={(event) => { event.preventDefault(); submitConfirm(); }}
            disabled={busyAction !== null}
            className={cn('h-9 bg-pink-600 hover:bg-pink-700')}
          >
            {busyAction === 'confirm' ? <Loader2 className="size-3.5 animate-spin" /> : <PenLine className="size-3.5" />} 确认使用
          </Button>
        </form>
      </div>
    </div>
  );
}

function BatchFormDialog({
  open,
  onOpenChange,
  compoundId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  compoundId: string;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    batchNumber: '',
    synthesizedAt: new Date().toISOString().slice(0, 10),
    procedure: '',
    productMass: '',
    yieldPercent: '',
    purityPercent: '',
    note: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!form.batchNumber.trim() || !form.procedure.trim()) {
      toast.error('批次号和合成步骤为必填');
      return;
    }
    setSubmitting(true);
    try {
      const res = await authFetch(`/api/compounds/${compoundId}/batches`, {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          productMass: form.productMass ? Number(form.productMass) : undefined,
          yieldPercent: form.yieldPercent ? Number(form.yieldPercent) : undefined,
          purityPercent: form.purityPercent ? Number(form.purityPercent) : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('已添加批次');
        setForm({
          batchNumber: '',
          synthesizedAt: new Date().toISOString().slice(0, 10),
          procedure: '',
          productMass: '',
          yieldPercent: '',
          purityPercent: '',
          note: '',
        });
        onSaved();
      } else {
        toast.error(data.error || '添加失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '网络错误');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>添加合成批次</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>批次号 *</Label>
            <Input
              value={form.batchNumber}
              onChange={(e) => setForm({ ...form, batchNumber: e.target.value })}
              placeholder="如 B01"
            />
          </div>
          <div>
            <Label>合成日期 *</Label>
            <Input
              type="date"
              value={form.synthesizedAt}
              onChange={(e) => setForm({ ...form, synthesizedAt: e.target.value })}
            />
          </div>
          <div className="col-span-2">
            <Label>合成步骤 *</Label>
            <Textarea
              value={form.procedure}
              onChange={(e) => setForm({ ...form, procedure: e.target.value })}
              rows={5}
              placeholder="详细合成步骤"
            />
          </div>
          <div>
            <Label>产物质量 (g)</Label>
            <Input
              type="number"
              value={form.productMass}
              onChange={(e) => setForm({ ...form, productMass: e.target.value })}
            />
          </div>
          <div>
            <Label>收率 (%)</Label>
            <Input
              type="number"
              value={form.yieldPercent}
              onChange={(e) => setForm({ ...form, yieldPercent: e.target.value })}
            />
          </div>
          <div>
            <Label>纯度 (%)</Label>
            <Input
              type="number"
              value={form.purityPercent}
              onChange={(e) => setForm({ ...form, purityPercent: e.target.value })}
            />
          </div>
          <div className="col-span-2">
            <Label>备注</Label>
            <Textarea
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssayFormDialog({
  open,
  onOpenChange,
  compoundId,
  batches,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  compoundId: string;
  batches: SynthesisBatch[];
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    assayType: 'ANTIBACTERIAL',
    target: '',
    batchId: '',
    resultSummary: '',
    result: '{}',
    conditions: '',
    conclusion: '',
    testedAt: new Date().toISOString().slice(0, 10),
    note: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!form.resultSummary.trim()) {
      toast.error('请填写结果摘要');
      return;
    }
    setSubmitting(true);
    try {
      // 构造 result JSON：自动从 resultSummary 提取
      const resultJson = JSON.stringify({ summary: form.resultSummary, conditions: form.conditions });
      const res = await authFetch(`/api/compounds/${compoundId}/bioassays`, {
        method: 'POST',
        body: JSON.stringify({
          assayType: form.assayType,
          target: form.target || undefined,
          batchId: form.batchId || undefined,
          result: resultJson,
          resultSummary: form.resultSummary,
          conditions: form.conditions ? JSON.stringify({ note: form.conditions }) : undefined,
          conclusion: form.conclusion || undefined,
          note: form.note || undefined,
          testedAt: form.testedAt,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('已添加测试记录');
        setForm({
          assayType: 'ANTIBACTERIAL',
          target: '',
          batchId: '',
          resultSummary: '',
          result: '{}',
          conditions: '',
          conclusion: '',
          testedAt: new Date().toISOString().slice(0, 10),
          note: '',
        });
        onSaved();
      } else {
        toast.error(data.error || '添加失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '网络错误');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>添加生物活性测试</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>测试类型 *</Label>
            <select
              value={form.assayType}
              onChange={(e) => setForm({ ...form, assayType: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {Object.entries(ASSAY_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>测试目标</Label>
            <Input
              value={form.target}
              onChange={(e) => setForm({ ...form, target: e.target.value })}
              placeholder="如 大肠杆菌"
            />
          </div>
          <div>
            <Label>关联批次</Label>
            <select
              value={form.batchId}
              onChange={(e) => setForm({ ...form, batchId: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">不关联</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batchNumber}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>测试日期</Label>
            <Input
              type="date"
              value={form.testedAt}
              onChange={(e) => setForm({ ...form, testedAt: e.target.value })}
            />
          </div>
          <div className="col-span-2">
            <Label>结果摘要 *</Label>
            <Input
              value={form.resultSummary}
              onChange={(e) => setForm({ ...form, resultSummary: e.target.value })}
              placeholder="如 IC50 = 12.3 μM"
            />
          </div>
          <div className="col-span-2">
            <Label>测试条件</Label>
            <Input
              value={form.conditions}
              onChange={(e) => setForm({ ...form, conditions: e.target.value })}
              placeholder="如 浓度 100 μg/mL, 24h, 三复孔"
            />
          </div>
          <div className="col-span-2">
            <Label>结论</Label>
            <Textarea
              value={form.conclusion}
              onChange={(e) => setForm({ ...form, conclusion: e.target.value })}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UsageFormDialog({
  open,
  onOpenChange,
  compoundId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  compoundId: string;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    usageType: 'ASSAY',
    quantity: '',
    unit: 'mg',
    purpose: '',
    usedAt: new Date().toISOString().slice(0, 10),
    note: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!form.quantity || Number(form.quantity) <= 0) {
      toast.error('请填写有效用量');
      return;
    }
    setSubmitting(true);
    try {
      const res = await authFetch(`/api/compounds/${compoundId}/usage-logs`, {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          quantity: Number(form.quantity),
          purpose: form.purpose || undefined,
          note: form.note || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('已添加使用记录');
        setForm({
          usageType: 'ASSAY',
          quantity: '',
          unit: 'mg',
          purpose: '',
          usedAt: new Date().toISOString().slice(0, 10),
          note: '',
        });
        onSaved();
      } else {
        toast.error(data.error || '添加失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '网络错误');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加使用记录</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>使用类型 *</Label>
            <select
              value={form.usageType}
              onChange={(e) => setForm({ ...form, usageType: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {Object.entries(USAGE_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>使用日期</Label>
            <Input
              type="date"
              value={form.usedAt}
              onChange={(e) => setForm({ ...form, usedAt: e.target.value })}
            />
          </div>
          <div>
            <Label>用量 *</Label>
            <Input
              type="number"
              step="any"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              placeholder="如 25"
            />
          </div>
          <div>
            <Label>单位 *</Label>
            <Input
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
              placeholder="mg / mL / μmol"
            />
          </div>
          <div className="col-span-2">
            <Label>用途/目的</Label>
            <Input
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
            />
          </div>
          <div className="col-span-2">
            <Label>备注</Label>
            <Textarea
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocFormDialog({
  open,
  onOpenChange,
  compoundId,
  batches,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  compoundId: string;
  batches: SynthesisBatch[];
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    docType: 'NMR',
    docSubtype: '',
    batchId: '',
    fileUrl: '',
    fileName: '',
    note: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!form.fileUrl.trim() || !form.fileName.trim()) {
      toast.error('请填写文件 URL 和文件名');
      return;
    }
    setSubmitting(true);
    try {
      const res = await authFetch(`/api/compounds/${compoundId}/documents`, {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          docSubtype: form.docSubtype || undefined,
          batchId: form.batchId || undefined,
          note: form.note || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('已添加文档');
        setForm({
          docType: 'NMR',
          docSubtype: '',
          batchId: '',
          fileUrl: '',
          fileName: '',
          note: '',
        });
        onSaved();
      } else {
        toast.error(data.error || '添加失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '网络错误');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加文档</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>文档类型 *</Label>
            <select
              value={form.docType}
              onChange={(e) => setForm({ ...form, docType: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {Object.entries(DOC_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>子类型</Label>
            <Input
              value={form.docSubtype}
              onChange={(e) => setForm({ ...form, docSubtype: e.target.value })}
              placeholder="如 1H / 13C"
            />
          </div>
          <div className="col-span-2">
            <Label>关联批次</Label>
            <select
              value={form.batchId}
              onChange={(e) => setForm({ ...form, batchId: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">不关联</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batchNumber}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <Label>文件 URL *</Label>
            <Input
              value={form.fileUrl}
              onChange={(e) => setForm({ ...form, fileUrl: e.target.value })}
              placeholder="https://..."
            />
          </div>
          <div className="col-span-2">
            <Label>文件名 *</Label>
            <Input
              value={form.fileName}
              onChange={(e) => setForm({ ...form, fileName: e.target.value })}
              placeholder="如 XY-001-B01-1HNMR.pdf"
            />
          </div>
          <div className="col-span-2">
            <Label>备注</Label>
            <Textarea
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              rows={2}
              placeholder="如 仪器型号、测试条件"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
