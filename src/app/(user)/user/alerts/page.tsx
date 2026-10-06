'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  FlaskConical,
  Search,
  Loader2,
  AlertTriangle,
  Package,
  Clock,
  XCircle,
  MapPin,
  Filter,
  Boxes,
  BarChart3,
  ImageOff,
  ShieldCheck,
  ShieldAlert,
  X,
  ZoomIn,
  PenTool,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog } from '@/arco-adapters/dialog';
import { ReagentStockInContent } from '@/components/reagents/reagent-stock-in-content';
import { SmilesDrawerModal } from '@/components/smiles-drawer-modal';
import { authFetch } from '@/lib/auth-fetch';
import { loadRDKit, filterBySubstructure, filterByExactMatch } from '@/lib/rdkit';
import { formatAmount, getStockDisplayText } from '@/lib/reagent-units';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth-store';

// ─── 类型定义 ───
interface ReagentItem {
  id: string;
  name: string;
  casNumber: string | null;
  specification: string | null;
  brand: string | null;
  dangerCategory: string | null;
  riskLevel: string;
  isHazardous: boolean;
  isControlled: boolean;
  storageLocation: string | null;
  stockQuantity: number;
  totalStockedBottles: number | null;
  minStock: number;
  unit: string | null;
  // 容量与密度信息（用于单位换算）
  capacityPerUnit: number | null;
  capacityUnit: string | null;
  density: number | null;
  expiryDate: string | null;
  structureImgUrl: string | null;
  smiles: string | null;
  stockInDate: string | null;
  stockInOperatorId: string | null;
  stockInOperator?: { id: string; name: string } | null;
}

interface ReagentListResponse {
  data: ReagentItem[];
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

// ─── 数据获取 ───
async function fetchReagents(params: {
  search: string;
  riskLevel: string;
  isControlled: string;
  page: number;
  pageSize: number;
  smilesSearch?: string;
  smilesMode?: 'exact' | 'substructure';
}): Promise<ReagentListResponse> {
  const sp = new URLSearchParams();
  if (params.search) sp.set('search', params.search);
  if (params.riskLevel) sp.set('riskLevel', params.riskLevel);
  if (params.isControlled === 'true') sp.set('isControlled', 'true');
  if (params.smilesSearch) { sp.set('smilesSearch', params.smilesSearch); sp.set('smilesMode', params.smilesMode || 'exact'); }
  sp.set('page', String(params.page));
  sp.set('pageSize', String(params.pageSize));
  const res = await authFetch(`/api/reagents?${sp.toString()}`);
  if (!res.ok) throw new Error('获取试剂列表失败');
  return res.json();
}

// ─── 站内结构式图片 URL：服务端 RDKit 优先、PubChem 降级 ───
function getStructureImageUrl(reagent: ReagentItem): string | null {
  if (!reagent.smiles && !reagent.structureImgUrl && !reagent.casNumber) return null;
  return `/api/reagents/${encodeURIComponent(reagent.id)}/structure`;
}

// ─── 风险等级配置（精简为 LOW | HIGH）───
const riskLevelConfig: Record<string, { label: string; className: string }> = {
  LOW: { label: '低风险', className: 'bg-sky-100 text-sky-700' },
  HIGH: { label: '高风险', className: 'bg-red-100 text-red-700' },
};

// ─── 辅助函数 ───
function getStockStatus(item: ReagentItem): { label: string; className: string; dotClass: string } {
  if (item.stockQuantity <= 0) {
    return { label: '无库存', className: 'bg-red-100 text-red-700', dotClass: 'bg-red-500' };
  }
  if (item.stockQuantity <= item.minStock) {
    return { label: '低库存', className: 'bg-amber-100 text-amber-700', dotClass: 'bg-amber-500' };
  }
  return { label: '正常', className: 'bg-emerald-100 text-emerald-700', dotClass: 'bg-emerald-500' };
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  try {
    return format(new Date(dateStr), 'yyyy-MM-dd');
  } catch {
    return dateStr;
  }
}

// 判断试剂是否可直接领用（低风险且非管制品）
function canDirectCheckout(item: ReagentItem): boolean {
  return item.riskLevel === 'LOW' && !item.isControlled;
}

// ─── 主页面 ───
export default function UserReagentOverviewPage() {
  const [activeTab, setActiveTab] = useState<'overview' | 'stats'>('overview');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [riskLevel, setRiskLevel] = useState('');
  const [controlledFilter, setControlledFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // SMILES 化学式查询相关状态
  const [smilesSearch, setSmilesSearch] = useState('');
  const [smilesMode, setSmilesMode] = useState<'exact' | 'substructure'>('exact');
  const [smilesDrawerOpen, setSmilesDrawerOpen] = useState(false);
  const [stockInOpen, setStockInOpen] = useState(false);
  const [activeSmilesFilter, setActiveSmilesFilter] = useState<{ smiles: string; mode: 'exact' | 'substructure' } | null>(null);

  // RDKit 子结构匹配
  const [rdkit, setRdkit] = useState<any>(null);
  const [rdkitLoading, setRdkitLoading] = useState(false);

  // 搜索防抖：输入停止 300ms 后才触发 API 请求
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(() => 1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);
  // 精准/子结构搜索均需加载 RDKit WASM
  useEffect(() => {
    if (activeSmilesFilter && !rdkit && !rdkitLoading) {
      setRdkitLoading(true);
      loadRDKit().then(setRdkit).catch((e) => console.error('RDKit load failed:', e)).finally(() => setRdkitLoading(false));
    }
  }, [activeSmilesFilter, rdkit, rdkitLoading]);

  // 精准/子结构搜索均需全部数据在前端用 RDKit 过滤
  const effectivePageSize = activeSmilesFilter ? 500 : pageSize;
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['user-reagents', debouncedSearch, riskLevel, controlledFilter, page, effectivePageSize, activeSmilesFilter],
    queryFn: () => fetchReagents({ search: debouncedSearch, riskLevel, isControlled: controlledFilter, page, pageSize: effectivePageSize, smilesSearch: activeSmilesFilter?.smiles, smilesMode: activeSmilesFilter?.mode }),
  });

  const reagents = useMemo(() => {
    const list = data?.data ?? [];
    if (!activeSmilesFilter || !rdkit || !activeSmilesFilter.smiles) return list;
    if (activeSmilesFilter.mode === 'exact') {
      return filterByExactMatch(rdkit, list, activeSmilesFilter.smiles, (r: ReagentItem) => r.smiles);
    }
    return filterBySubstructure(rdkit, list, activeSmilesFilter.smiles, (r: ReagentItem) => r.smiles);
  }, [data, activeSmilesFilter, rdkit]);

  // 统计摘要（基于当前页数据）
  const summary = useMemo(() => {
    const total = reagents.length;
    const lowStock = reagents.filter((r) => r.stockQuantity <= r.minStock).length;
    const now = new Date();
    const expiring = reagents.filter((r) => {
      if (!r.expiryDate) return false;
      const d = new Date(r.expiryDate);
      const diff = Math.floor((d.getTime() - now.getTime()) / 86400000);
      return diff >= 0 && diff <= 30;
    }).length;
    const expired = reagents.filter((r) => {
      if (!r.expiryDate) return false;
      return new Date(r.expiryDate) < now;
    }).length;
    return { total, lowStock, expiring, expired };
  }, [reagents]);

  return (
    <div className="space-y-6">
      {/* 二级入口 Tab 导航 */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        <TabButton
          active={activeTab === 'overview'}
          onClick={() => setActiveTab('overview')}
          icon={Boxes}
          label="试剂总览"
        />
        <TabButton
          active={activeTab === 'stats'}
          onClick={() => setActiveTab('stats')}
          icon={BarChart3}
          label="试剂统计"
        />
      </div>

      {/* Tab 内容 */}
      {activeTab === 'overview' && (
        <OverviewTab
          search={search}
          setSearch={setSearch}
          riskLevel={riskLevel}
          setRiskLevel={setRiskLevel}
          controlledFilter={controlledFilter}
          setControlledFilter={setControlledFilter}
          page={page}
          setPage={setPage}
          pageSize={pageSize}
          setPageSize={setPageSize}
          data={data}
          reagents={reagents}
          isLoading={isLoading}
          isError={isError}
          error={error}
          smilesSearch={smilesSearch}
          setSmilesSearch={setSmilesSearch}
          smilesMode={smilesMode}
          setSmilesMode={setSmilesMode}
          smilesDrawerOpen={smilesDrawerOpen}
          setSmilesDrawerOpen={setSmilesDrawerOpen}
          activeSmilesFilter={activeSmilesFilter}
          setActiveSmilesFilter={setActiveSmilesFilter}
          onOpenStockIn={() => setStockInOpen(true)}
        />
      )}

      {activeTab === 'stats' && <StatsTab summary={summary} />}

      <Dialog open={stockInOpen} onOpenChange={setStockInOpen} title="试剂入库" width={1160} footer={null}>
        <div className="max-h-[72vh] overflow-y-auto px-1">
          <ReagentStockInContent embedded onCompleted={() => setStockInOpen(false)} />
        </div>
      </Dialog>
    </div>
  );
}

// ─── Tab 按钮组件 ───
function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all duration-200 border-b-2 -mb-px',
        active
          ? 'border-emerald-500 text-emerald-600'
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
      )}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}

// ─── 试剂总览 Tab ───
function OverviewTab(props: {
  search: string;
  setSearch: (v: string) => void;
  riskLevel: string;
  setRiskLevel: (v: string) => void;
  controlledFilter: string;
  setControlledFilter: (v: string) => void;
  page: number;
  setPage: (fn: (p: number) => number) => void;
  pageSize: number;
  setPageSize: (v: number) => void;
  data: ReagentListResponse | undefined;
  reagents: ReagentItem[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  smilesSearch: string;
  setSmilesSearch: (v: string) => void;
  smilesMode: 'exact' | 'substructure';
  setSmilesMode: (v: 'exact' | 'substructure') => void;
  smilesDrawerOpen: boolean;
  setSmilesDrawerOpen: (v: boolean) => void;
  activeSmilesFilter: { smiles: string; mode: 'exact' | 'substructure' } | null;
  setActiveSmilesFilter: (v: { smiles: string; mode: 'exact' | 'substructure' } | null) => void;
  onOpenStockIn: () => void;
}) {
  const {
    search, setSearch, riskLevel, setRiskLevel,
    controlledFilter, setControlledFilter,
    page, setPage, pageSize, setPageSize, data, reagents, isLoading, isError, error,
    smilesSearch, setSmilesSearch, smilesMode, setSmilesMode,
    smilesDrawerOpen, setSmilesDrawerOpen, activeSmilesFilter, setActiveSmilesFilter,
    onOpenStockIn,
  } = props;

  // 领用/申请弹窗状态
  const [modalMode, setModalMode] = useState<'checkout' | 'apply' | null>(null);
  const [selectedReagent, setSelectedReagent] = useState<ReagentItem | null>(null);
  // 结构式大图状态
  const [enlargedImg, setEnlargedImg] = useState<{ url: string; name: string } | null>(null);

  const openModal = (reagent: ReagentItem) => {
    setSelectedReagent(reagent);
    setModalMode(canDirectCheckout(reagent) ? 'checkout' : 'apply');
  };

  const closeModal = () => {
    setModalMode(null);
    setSelectedReagent(null);
  };

  const handleStructureClick = (reagent: ReagentItem) => {
    const url = getStructureImageUrl(reagent);
    if (url) setEnlargedImg({ url, name: reagent.name });
  };

  return (
    <div className="space-y-4">
      {/* 搜索和筛选 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="搜索试剂名称或 CAS 号..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            className="pl-8"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="size-4 text-gray-400" />
          <Button
            variant={riskLevel === '' && controlledFilter === '' ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setRiskLevel(''); setControlledFilter(''); setPage(() => 1); }}
          >
            全部
          </Button>
          <Button
            variant={riskLevel === 'LOW' && controlledFilter === '' ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setRiskLevel('LOW'); setControlledFilter(''); setPage(() => 1); }}
          >
            低风险
          </Button>
          <Button
            variant={riskLevel === 'HIGH' && controlledFilter === '' ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setRiskLevel('HIGH'); setControlledFilter(''); setPage(() => 1); }}
          >
            高风险
          </Button>
          <Button
            variant={controlledFilter === 'true' ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setRiskLevel(''); setControlledFilter('true'); setPage(() => 1); }}
          >
            管制品
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSmilesDrawerOpen(true)}
            className="border-cyan-400 text-cyan-600 hover:bg-cyan-50 hover:text-cyan-700"
          >
            <PenTool className="size-3.5" />
            化学式查询
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenStockIn}
            className="border-rose-400 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
          >
            <FlaskConical className="size-3.5" />
            试剂入库
          </Button>
        </div>
        {/* 右侧：分页信息 + 翻页 + 每页条数 */}
        <div className="ml-auto flex items-center gap-3">
          {data && data.pagination.totalPages > 1 && (
            <>
              <p className="text-xs text-gray-500 whitespace-nowrap">
                共 {data.pagination.total} 条，第 {data.pagination.page} / {data.pagination.totalPages} 页
              </p>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-7 px-2 text-xs"
                >
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= data.pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="h-7 px-2 text-xs"
                >
                  下一页
                </Button>
              </div>
            </>
          )}
          {/* 每页条数选择 */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400">每页</span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(() => 1); }}
              className="h-7 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700 transition-colors hover:border-gray-300 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/15"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
            <span className="text-xs text-gray-400">条</span>
          </div>
        </div>
      </div>

      {/* 活跃 SMILES 过滤提示条 */}
      {activeSmilesFilter && (
        <div className="flex items-center gap-2 rounded-md border border-cyan-300 bg-cyan-50 px-3 py-2 text-xs">
          <PenTool className="size-3.5 text-cyan-700" />
          <span className="font-medium text-cyan-800">
            {activeSmilesFilter.mode === 'exact' ? '精准匹配' : '子结构匹配'}：
          </span>
          <code className="rounded bg-white px-2 py-0.5 font-mono text-cyan-900">
            {activeSmilesFilter.smiles}
          </code>
          <button
            type="button"
            onClick={() => { setActiveSmilesFilter(null); setSmilesSearch(''); setSmilesMode('exact'); setPage(() => 1); }}
            className="ml-auto inline-flex size-5 items-center justify-center rounded-full text-cyan-700 hover:bg-cyan-200"
          >
            <X className="size-3" />
          </button>
        </div>
      )}

      {/* 试剂表格 */}
      <Card className="overflow-hidden border-gray-200 shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-gray-400" />
              <span className="ml-2 text-sm text-gray-500">加载中...</span>
            </div>
          ) : isError ? (
            <div className="py-12 text-center">
              <AlertTriangle className="size-10 mx-auto mb-3 text-red-400" />
              <p className="text-sm text-red-500">{error instanceof Error ? error.message : '加载失败'}</p>
            </div>
          ) : reagents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Package className="size-10 text-gray-300 mb-2" />
              <p className="text-sm text-gray-400">暂无试剂数据</p>
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
                    <th className="border-b border-slate-100 px-4 py-3 text-center whitespace-nowrap">品牌/规格</th>
                    <th className="border-b border-slate-100 px-4 py-3 text-center whitespace-nowrap">存量</th>
                    <th className="border-b border-slate-100 px-4 py-3 text-center whitespace-nowrap">存放位置</th>
                    <th className="border-b border-slate-100 px-4 py-3 text-center whitespace-nowrap">入库日</th>
                    <th className="border-b border-slate-100 px-4 py-3 text-center whitespace-nowrap">入库人</th>
                    <th className="border-b border-slate-100 px-4 py-3 text-center whitespace-nowrap">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {reagents.map((r) => {
                    const risk = riskLevelConfig[r.riskLevel] ?? riskLevelConfig.LOW;
                    const stockStatus = getStockStatus(r);
                    // 列表存量展示：主显示剩余总量（质量/体积），副显示单瓶容量规格
                    // 不显示剩余瓶数，避免浮点精度问题
                    const stockDisplay = getStockDisplayText({
                      stockQuantity: r.stockQuantity,
                      unit: r.unit,
                      capacityPerUnit: r.capacityPerUnit,
                      capacityUnit: r.capacityUnit,
                      totalStockedBottles: r.totalStockedBottles,
                    });
                    return (
                      <tr key={r.id} className="hover:bg-gray-50/60 transition-colors">
                        {/* 结构式（可点击看大图）*/}
                        <td className="px-4 py-3 text-center">
                          <StructureImage reagent={r} onClick={() => handleStructureClick(r)} />
                        </td>
                        {/* 试剂名称（可点击查看详情）*/}
                        <td className="px-3 py-3 text-center max-w-[120px]">
                          <Link href={`/user/reagents/${r.id}`} className="inline-flex flex-col items-center gap-0.5 group">
                            <span className="font-medium text-gray-900 break-all leading-snug group-hover:text-teal-600 group-hover:underline transition-colors">{r.name}</span>
                            {r.isControlled && (
                              <Badge className="bg-purple-100 text-purple-700 text-[10px] px-1.5 py-0">管制品</Badge>
                            )}
                          </Link>
                        </td>
                        {/* CAS 号 */}
                        <td className="px-3 py-3 text-center text-gray-600 font-mono">
                          {r.casNumber || '-'}
                        </td>
                        {/* 风险等级 */}
                        <td className="px-3 py-3 text-center">
                          <Badge className={risk.className}>{risk.label}</Badge>
                        </td>
                        {/* 品牌/规格（收窄）*/}
                        <td className="px-3 py-3 text-center text-gray-600 max-w-[80px]">
                          <div className="truncate" title={r.brand || ''}>{r.brand || '-'}</div>
                          {r.specification && <div className="text-gray-400 truncate" title={r.specification}>{r.specification}</div>}
                        </td>
                        {/* 存量：主显示剩余总量（质量/体积），副显示单瓶容量规格 */}
                        <td className="px-3 py-3 text-center">
                          <div className="inline-flex flex-col items-center gap-0.5">
                            <span className={cn('font-semibold', stockStatus.label === '正常' ? 'text-gray-700' : stockStatus.label === '低库存' ? 'text-amber-600' : 'text-red-600')}>
                              {stockDisplay.primary}
                            </span>
                            {stockDisplay.secondary && (
                              <span className="text-[10px] text-gray-400">{stockDisplay.secondary}</span>
                            )}
                            <span className="inline-flex items-center gap-1">
                              <span className={cn('size-1.5 rounded-full', stockStatus.dotClass)} />
                              <span className="text-gray-400">{stockStatus.label}</span>
                            </span>
                          </div>
                        </td>
                        {/* 存放位置 */}
                        <td className="px-3 py-3 text-center">
                          {r.storageLocation ? (
                            <div className="inline-flex items-center gap-1 text-gray-600">
                              <MapPin className="size-3 text-gray-400" />
                              <span>{r.storageLocation}</span>
                            </div>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        {/* 入库日 */}
                        <td className="px-3 py-3 text-center text-gray-600 whitespace-nowrap">
                          {formatDate(r.stockInDate)}
                        </td>
                        {/* 入库人 */}
                        <td className="px-3 py-3 text-center text-gray-600">
                          {r.stockInOperator?.name || '-'}
                        </td>
                        {/* 操作 */}
                        <td className="px-3 py-3 text-center">
                          <Button
                            size="sm"
                            variant={canDirectCheckout(r) ? 'default' : 'outline'}
                            onClick={() => openModal(r)}
                            disabled={r.stockQuantity <= 0}
                            className={cn(canDirectCheckout(r) ? 'bg-emerald-600 hover:bg-emerald-700' : 'border-orange-400 text-orange-600 hover:bg-orange-50')}
                          >
                            {canDirectCheckout(r) ? '领用' : '申请'}
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

      {/* 结构式大图 Lightbox */}
      {enlargedImg && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-8"
          onClick={() => setEnlargedImg(null)}
        >
          {/* 试剂名称显示在图片上方，不遮挡图片 */}
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

      {/* 领用/申请弹窗 */}
      {modalMode && selectedReagent && (
        <ReagentActionModal
          reagent={selectedReagent}
          mode={modalMode}
          onClose={closeModal}
        />
      )}

      {/* 化学式绘制查询弹窗 */}
      <SmilesDrawerModal
        open={smilesDrawerOpen}
        onClose={() => setSmilesDrawerOpen(false)}
        onSearch={(smiles, mode) => {
          setSmilesSearch(smiles);
          setSmilesMode(mode);
          setActiveSmilesFilter({ smiles, mode });
          setSmilesDrawerOpen(false);
          setPage(() => 1);
        }}
        initialSmiles={smilesSearch}
        title="化学式查询试剂"
      />
    </div>
  );
}

// ─── 结构式图片组件（RDKit 优先 + PubChem 降级 + 懒加载 + 可点击大图）───
function StructureImage({ reagent, onClick }: { reagent: ReagentItem; onClick?: () => void }) {
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
        className="group relative mx-auto size-28 overflow-hidden rounded-xl border border-slate-200 bg-white transition-all hover:border-emerald-300 hover:shadow-md"
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

// ─── 试剂统计 Tab ───
function StatsTab({ summary }: { summary: { total: number; lowStock: number; expiring: number; expired: number } }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryCard icon={FlaskConical} label="试剂总数" value={summary.total} color="from-cyan-500 to-blue-400" />
        <SummaryCard icon={AlertTriangle} label="低库存" value={summary.lowStock} color="from-amber-500 to-orange-400" />
        <SummaryCard icon={Clock} label="临期(30天)" value={summary.expiring} color="from-orange-500 to-rose-400" />
        <SummaryCard icon={XCircle} label="已过期" value={summary.expired} color="from-red-500 to-pink-400" />
      </div>
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
              <BarChart3 className="size-5 text-emerald-600" />
            </div>
            <div className="text-sm text-gray-600 leading-relaxed">
              <p className="font-medium text-gray-800 mb-1">统计说明</p>
              <p>以上统计数据基于当前试剂库的实时快照，用于辅助库存管理与安全预警。</p>
              <ul className="mt-2 space-y-1 text-xs text-gray-500">
                <li>• <strong>试剂总数</strong>：本实验室当前在册的试剂种类数量</li>
                <li>• <strong>低库存</strong>：当前库存量低于或等于最低库存阈值的试剂</li>
                <li>• <strong>临期(30天)</strong>：有效期在 30 天内的试剂</li>
                <li>• <strong>已过期</strong>：有效期已过的试剂，建议及时处置</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── 统计卡片组件 ───
function SummaryCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className={cn('absolute top-0 left-0 h-0.5 w-full bg-gradient-to-r', color)} />
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-gray-500">{label}</p>
          <p className="text-2xl font-black text-gray-800 mt-1">{value}</p>
        </div>
        <div className={cn('flex size-8 items-center justify-center rounded-lg bg-gradient-to-br text-white', color)}>
          <Icon className="size-4" />
        </div>
      </div>
    </div>
  );
}

// ─── 领用/申请弹窗组件 ───
function ReagentActionModal({
  reagent,
  mode,
  onClose,
}: {
  reagent: ReagentItem;
  mode: 'checkout' | 'apply';
  onClose: () => void;
}) {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  // 表单状态
  const [quantity, setQuantity] = useState<number>(1);
  const [unit, setUnit] = useState(() => {
    // 默认单位：仅当试剂单位属于常见化学单位时沿用，否则留空让用户选择
    const COMMON_UNITS = ['L', 'mL', 'g', 'mg'];
    const reagentUnit = reagent.unit?.trim();
    return reagentUnit && COMMON_UNITS.includes(reagentUnit) ? reagentUnit : '';
  });
  const [usageTime, setUsageTime] = useState('');
  const [purpose, setPurpose] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  // 同试剂其他规格批次（用于多规格展示与总量估算）
  const [siblings, setSiblings] = useState<Array<{
    id: string;
    specification: string | null;
    stockQuantity: number;
    unit: string | null;
    capacityPerUnit: number | null;
    capacityUnit: string | null;
  }>>([]);

  const isCheckout = mode === 'checkout';

  // 加载同试剂其他规格批次（excludeId 排除当前试剂）
  useEffect(() => {
    const loadSiblings = async () => {
      try {
        const params = new URLSearchParams();
        if (reagent.name) params.set('name', reagent.name);
        if (reagent.casNumber) params.set('casNumber', reagent.casNumber);
        params.set('excludeId', reagent.id);
        const res = await authFetch(`/api/reagents/lookup?${params.toString()}`);
        if (!res.ok) return;
        const data = await res.json();
        setSiblings(data.siblings || []);
      } catch {
        // 查询失败不阻断
      }
    };
    loadSiblings();
  }, [reagent.id, reagent.name, reagent.casNumber]);

  // 实时换算预览：显示领用后剩余量（主显示为质量/体积）
  // 后端会做权威换算，前端提示仅辅助用户理解
  const conversionHint = useMemo(() => {
    if (!quantity || quantity <= 0 || !unit.trim()) return null;
    const stockUnit = reagent.unit?.trim() || '瓶';
    const reqUnit = unit.trim();

    // 同单位：直接显示
    if (reqUnit === stockUnit) {
      const remaining = Math.max(0, reagent.stockQuantity - quantity);
      return `将扣减 ${quantity} ${stockUnit}，剩余 ${remaining} ${stockUnit}`;
    }

    // 库存是"瓶"等计数单位，且有容量信息
    const COUNT_UNITS = ['瓶', '支', '包', '盒', '罐', '袋', '件'];
    const isStockCount = COUNT_UNITS.includes(stockUnit);
    if (isStockCount && reagent.capacityPerUnit && reagent.capacityUnit) {
      const capUnit = reagent.capacityUnit;
      // 简单同类换算（mL/L、g/mg）
      const sameCategory = (a: string, b: string) => {
        const vol = ['mL', 'ml', 'L', 'l'];
        const mass = ['g', 'mg', 'kg'];
        const aLow = a.toLowerCase();
        const bLow = b.toLowerCase();
        return (vol.includes(aLow) && vol.includes(bLow)) || (mass.includes(aLow) && mass.includes(bLow));
      };
      if (sameCategory(reqUnit, capUnit)) {
        // 把用户输入换算到容量单位（粗略，仅用于 UI 提示）
        const reqLow = reqUnit.toLowerCase();
        const capLow = capUnit.toLowerCase();
        let userInCapUnit = quantity;
        // 体积类：统一到 mL
        if (reqLow === 'l') userInCapUnit = quantity * 1000;
        if (capLow === 'l') userInCapUnit = quantity / 1000;
        // 质量类：统一到 mg（如果容量单位是 mg）或 g（如果容量单位是 g）
        if (reqLow === 'g' && capLow === 'mg') userInCapUnit = quantity * 1000;
        if (reqLow === 'mg' && capLow === 'g') userInCapUnit = quantity / 1000;
        if (reqLow === 'kg' && capLow === 'g') userInCapUnit = quantity * 1000;
        if (reqLow === 'kg' && capLow === 'mg') userInCapUnit = quantity * 1_000_000;

        const totalAmount = reagent.stockQuantity * reagent.capacityPerUnit;
        const remainingAmount = Math.max(0, totalAmount - userInCapUnit);
        const remainingStr = formatAmount(remainingAmount, capUnit);
        const userStr = formatAmount(userInCapUnit, capUnit);
        return `领用 ${userStr}，剩余 ${remainingStr}（精确换算由后端完成）`;
      }
      if (reagent.density) {
        return `需体积↔质量换算（密度 ${reagent.density} g/mL），后端将自动计算`;
      }
      return `⚠️ 试剂缺少密度信息，无法换算 ${reqUnit} → ${capUnit}，请联系管理员补充`;
    }

    return null;
  }, [quantity, unit, reagent]);

  const handleSubmit = useCallback(async () => {
    // 基本校验
    if (!quantity || quantity <= 0) {
      setResult({ ok: false, message: '用量必须为正数' });
      return;
    }
    if (!unit.trim()) {
      setResult({ ok: false, message: '请选择或填写单位' });
      return;
    }
    if (!isCheckout) {
      if (!usageTime) {
        setResult({ ok: false, message: '请选择使用时间' });
        return;
      }
      if (!purpose.trim()) {
        setResult({ ok: false, message: '请填写用途说明' });
        return;
      }
    }

    setSubmitting(true);
    setResult(null);

    try {
      // 提交时传 requestedQuantity + requestedUnit
      // quantity 由后端换算后填充，前端传 requestedQuantity 占位
      const body: Record<string, unknown> = {
        reagentId: reagent.id,
        applicantId: user?.id,
        // 兼容后端 validation：quantity 必填，传 requestedQuantity 占位
        // 后端会用 convertToStockUnit 覆盖此值
        quantity: quantity,
        requestedQuantity: quantity,
        requestedUnit: unit.trim(),
        mode: isCheckout ? 'CHECKOUT' : 'APPLY',
      };
      if (!isCheckout) {
        body.usageTime = usageTime;
        body.purpose = purpose.trim();
      }

      const res = await authFetch('/api/requisitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || data.message || '提交失败');
      }

      // 成功提示：优先用后端返回的 conversionNote（已包含「已领用 X，剩余 Y」或「申请领用 X」格式）
      const conversionNote = data?.conversionNote;
      const fallbackStr = `${quantity} ${unit}`;
      const message = isCheckout
        ? `领用成功！${conversionNote || `已扣减 ${fallbackStr}`}`
        : `申请已提交（${conversionNote || fallbackStr}），等待管理员审批`;
      setResult({ ok: true, message });

      // 刷新试剂列表
      queryClient.invalidateQueries({ queryKey: ['user-reagents'] });
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : '提交失败，请重试' });
    } finally {
      setSubmitting(false);
    }
  }, [quantity, unit, usageTime, purpose, isCheckout, reagent, user, queryClient]);

  // 计算库存展示（当前试剂）
  // 主显示为剩余总量（质量/体积，如 "剩余 10 mg"），次要为单瓶容量规格（如 "5 g/瓶"）
  // 不显示剩余瓶数，避免 3.5999999999999996 瓶等浮点精度问题
  const stockDisplay = useMemo(() => {
    return getStockDisplayText({
      stockQuantity: reagent.stockQuantity,
      unit: reagent.unit,
      capacityPerUnit: reagent.capacityPerUnit,
      capacityUnit: reagent.capacityUnit,
      totalStockedBottles: reagent.totalStockedBottles,
    });
  }, [reagent]);

  // 多规格合并展示：当前试剂 + siblings 的全部规格与总量预估（粗略相加）
  const multiSpecDisplay = useMemo(() => {
    const all = [
      { id: reagent.id, specification: reagent.specification, stockQuantity: reagent.stockQuantity, unit: reagent.unit, capacityPerUnit: reagent.capacityPerUnit, capacityUnit: reagent.capacityUnit },
      ...siblings,
    ];
    if (all.length <= 1) return null;

    // 规格列表
    const specList = all
      .map((s) => s.specification || '未标注规格')
      .filter((v, i, arr) => arr.indexOf(v) === i); // 去重

    // 按容量单位分组估算总量（粗略相加）
    // 归并到大类：ml/l → mL；mg/g/kg → g
    const groups: Record<string, number> = {};
    for (const r of all) {
      if (r.capacityPerUnit && r.capacityUnit) {
        const u = r.capacityUnit.toLowerCase();
        // 归并到 mL 或 g 两个基准单位
        let key: string;
        let amount = r.capacityPerUnit * r.stockQuantity;
        if (u === 'ml' || u === 'l') {
          key = 'ml';
          if (u === 'l') amount *= 1000;
        } else if (u === 'mg' || u === 'g' || u === 'kg') {
          key = 'g';
          if (u === 'mg') amount /= 1000;
          if (u === 'kg') amount *= 1000;
        } else {
          key = u;
        }
        groups[key] = (groups[key] || 0) + amount;
      }
    }
    const totalStr = Object.entries(groups).map(([u, total]) => formatAmount(total, u)).join(' + ');

    return {
      specList,
      totalStr: totalStr || null,
      batchCount: all.length,
    };
  }, [reagent, siblings]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 遮罩层 */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* 弹窗主体 */}
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl">
        {/* 头部 */}
        <div className={cn(
          'flex items-center gap-3 rounded-t-2xl px-6 py-4 text-white',
          isCheckout ? 'bg-gradient-to-r from-emerald-500 to-teal-600' : 'bg-gradient-to-r from-orange-500 to-red-500'
        )}>
          <div className="flex size-9 items-center justify-center rounded-lg bg-white/20">
            {isCheckout ? <ShieldCheck className="size-5" /> : <ShieldAlert className="size-5" />}
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold">{isCheckout ? '试剂领用' : '试剂申请'}</h3>
            <p className="text-xs text-white/80">
              {isCheckout ? '低风险试剂，直接领用扣减库存' : '高风险/管制品，需管理员审批'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* 内容 */}
        <div className="space-y-4 px-6 py-5">
          {/* 试剂信息（只读）*/}
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
            <div className="flex items-center gap-3">
              <StructureImage reagent={reagent} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-900 truncate">{reagent.name}</span>
                  {reagent.isControlled && (
                    <Badge className="bg-purple-100 text-purple-700 text-[10px] px-1.5 py-0">管制品</Badge>
                  )}
                  {reagent.isHazardous && (
                    <Badge className="bg-red-100 text-red-700 text-[10px] px-1.5 py-0">危化品</Badge>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  CAS: {reagent.casNumber || '-'}
                </div>
                {/* 当前规格库存：主显示为质量/体积总量 */}
                <div className="mt-0.5 flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-emerald-700">
                    {stockDisplay.primary}
                  </span>
                  {stockDisplay.secondary && (
                    <span className="text-[11px] text-gray-400">
                      ({stockDisplay.secondary})
                    </span>
                  )}
                </div>
                {/* 当前试剂规格 */}
                {reagent.specification && (
                  <div className="text-xs text-gray-500 mt-0.5">
                    规格：{reagent.specification}
                  </div>
                )}
              </div>
            </div>
            {/* 多规格合并展示：同试剂存在多个规格批次时显示 */}
            {multiSpecDisplay && (
              <div className="mt-2 border-t border-gray-200 pt-2">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-sky-700">
                  <Boxes className="size-3" />
                  检测到 {multiSpecDisplay.batchCount} 个规格批次
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {multiSpecDisplay.specList.map((spec, i) => (
                    <Badge key={i} variant="outline" className="text-[10px] text-gray-600">
                      {spec}
                    </Badge>
                  ))}
                </div>
                {multiSpecDisplay.totalStr && (
                  <div className="mt-1 text-[11px] text-gray-500">
                    全部规格总量预估：{multiSpecDisplay.totalStr}（粗略相加，仅供参考）
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 领用人（系统自动填写）*/}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">领用人</label>
            <Input value={user?.name || ''} disabled className="bg-gray-50 text-gray-500" />
          </div>

          {/* 使用时间（仅申请模式）*/}
          {!isCheckout && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                使用时间 <span className="text-red-500">*</span>
              </label>
              <Input
                type="datetime-local"
                value={usageTime}
                onChange={(e) => setUsageTime(e.target.value)}
                required
              />
            </div>
          )}

          {/* 用量 + 单位（两个格子）*/}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              用量 <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              <Input
                type="number"
                min={0.0001}
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(parseFloat(e.target.value) || 0)}
                required
                className="flex-1"
                placeholder="如 50"
              />
              <Input
                list="reagent-unit-options"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                required
                className="w-24"
                placeholder="单位"
              />
              <datalist id="reagent-unit-options">
                <option value="L" />
                <option value="mL" />
                <option value="g" />
                <option value="mg" />
                {reagent.unit && <option value={reagent.unit} />}
              </datalist>
            </div>
            <p className="mt-1 text-[11px] text-gray-400">
              常见单位：L、mL、g、mg（也可用 {reagent.unit || '瓶'} 直接按库存单位领用）
            </p>
            {/* 换算提示 */}
            {conversionHint && (
              <div className={cn(
                'mt-2 rounded-md px-2.5 py-1.5 text-[11px] leading-relaxed',
                conversionHint.startsWith('⚠️')
                  ? 'bg-amber-50 text-amber-700'
                  : 'bg-blue-50 text-blue-700'
              )}>
                {conversionHint}
              </div>
            )}
          </div>

          {/* 用途（仅申请模式）*/}
          {!isCheckout && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                用途 <span className="text-red-500">*</span>
              </label>
              <Textarea
                placeholder="请详细描述试剂用途（必填，最多 500 字）"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                rows={3}
                maxLength={500}
                required
              />
            </div>
          )}

          {/* 结果提示 */}
          {result && (
            <div className={cn(
              'flex items-start gap-2 rounded-lg p-3 text-sm',
              result.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
            )}>
              {result.ok ? <ShieldCheck className="size-4 mt-0.5 shrink-0" /> : <AlertTriangle className="size-4 mt-0.5 shrink-0" />}
              <span>{result.message}</span>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex gap-2 px-6 py-4 border-t border-gray-100">
          <Button variant="outline" onClick={onClose} className="flex-1">
            {result?.ok ? '关闭' : '取消'}
          </Button>
          {!result?.ok && (
            <Button
              onClick={handleSubmit}
              disabled={submitting}
              className={cn(
                'flex-1',
                isCheckout ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-orange-500 hover:bg-orange-600'
              )}
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 mr-1 animate-spin" />
                  提交中...
                </>
              ) : isCheckout ? '确认领用' : '提交申请'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
