"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { Search, X, AlertCircle, Loader2, Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getStandardSmiles, runKetcherOperation, type KetcherApi } from "@/lib/ketcher";

const KetcherEditor = dynamic(
  () => import("@/components/ketcher-editor").then((m) => m.KetcherEditor),
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

// ketcher 实例类型（避免直接引用 ketcher-core 导致 SSR 类型冲突）

interface SmilesDrawerModalProps {
  open: boolean;
  onClose: () => void;
  onSearch: (smiles: string, mode: "exact" | "substructure") => void;
  initialSmiles?: string;
  title?: string;
}

export function SmilesDrawerModal({
  open,
  onClose,
  onSearch,
  initialSmiles = "",
  title = "化学式查询",
}: SmilesDrawerModalProps) {
  const [smilesInput, setSmilesInput] = useState(initialSmiles);
  const [mode, setMode] = useState<"exact" | "substructure">("exact");
  const [error, setError] = useState<string | null>(null);
  const [ketcherReady, setKetcherReady] = useState(false);
  const [busyAction, setBusyAction] = useState<"load" | "get" | "search" | null>(null);
  const [hasOpened, setHasOpened] = useState(open);
  const ketcherRef = useRef<KetcherApi | null>(null);

  useEffect(() => {
    if (!open) return;
    setHasOpened(true);
    setSmilesInput(initialSmiles);
    setError(null);
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
    setError("绘图引擎错误: " + msg);
  }, []);

  const getSmilesFromCanvas = async (): Promise<string | null> => {
    if (!ketcherRef.current) return null;
    const smiles = await getStandardSmiles(ketcherRef.current);
    return smiles?.trim() || null;
  };

  const handleLoadToCanvas = async () => {
    const ketcher = ketcherRef.current;
    if (!ketcher || !smilesInput.trim()) return;
    setBusyAction("load");
    setError(null);
    try {
      await runKetcherOperation(() => ketcher.setMolecule(smilesInput.trim()));
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : "SMILES 解析失败，请检查格式");
    } finally {
      setBusyAction(null);
    }
  };

  const handleSyncFromCanvas = async () => {
    setBusyAction("get");
    setError(null);
    try {
      const smiles = await getSmilesFromCanvas();
      if (smiles) {
        setSmilesInput(smiles);
      } else {
        setError("画布为空，请先绘制分子结构");
      }
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : "无法从画布读取结构，请重试");
    } finally {
      setBusyAction(null);
    }
  };

  const handleClear = async () => {
    setSmilesInput("");
    setError(null);
    const ketcher = ketcherRef.current;
    if (ketcher) {
      try {
        await runKetcherOperation(() => ketcher.clear());
      } catch {}
    }
  };

  const handleSearch = async () => {
    if (busyAction) return;
    setBusyAction("search");
    setError(null);
    // 输入框有值时直接查询，避免无意义地等待 Ketcher 序列化画布。
    let finalSmiles = smilesInput.trim();
    try {
      if (!finalSmiles && ketcherReady) {
        try {
          const canvasSmiles = await getSmilesFromCanvas();
          if (canvasSmiles) finalSmiles = canvasSmiles;
        } catch {
          // 画布读取超时时仍允许直接使用输入框内容查询。
        }
      }
      if (!finalSmiles) {
        setError("请绘制分子结构或输入 SMILES 字符串");
        return;
      }
      onSearch(finalSmiles, mode);
      onClose();
    } finally {
      setBusyAction(null);
    }
  };

  const submitSearch = () => {
    if (busyAction) return;
    const typedSmiles = smilesInput.trim();
    if (typedSmiles) {
      setError(null);
      onSearch(typedSmiles, mode);
      onClose();
      return;
    }
    void handleSearch();
  };

  if (!hasOpened) return null;

  const quickSmiles = [
    { label: "苯环", value: "c1ccccc1" },
    { label: "乙醇", value: "CCO" },
    { label: "乙酸", value: "CC(=O)O" },
    { label: "丙酮", value: "CC(=O)C" },
    { label: "水", value: "O" },
    { label: "甲烷", value: "C" },
  ];

  return (
    <div className={cn("fixed inset-0 z-[80] items-center justify-center bg-black/50 p-4", open ? "flex" : "hidden")}>
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 text-white">
              <Search className="size-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">{title}</h3>
              <p className="text-xs text-gray-500">绘制分子结构或输入 SMILES 进行查询</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600">
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-700">分子结构绘图器</label>
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <KetcherEditor onInit={handleKetcherInit} onError={handleKetcherError} />
              </div>
              <p className="mt-1.5 text-[11px] text-gray-400">使用上方工具栏绘制分子结构，或在右侧输入 SMILES 后点击「加载到画布」</p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-700">SMILES 字符串</label>
                <Input value={smilesInput} onChange={(e) => setSmilesInput(e.target.value)} placeholder="如 CCO、c1ccccc1" className="font-mono text-sm" />
                <div className="mt-1.5 flex gap-1.5">
                  <Button variant="outline" size="sm" className="h-7 flex-1 text-xs" onClick={handleLoadToCanvas} disabled={!smilesInput.trim() || !ketcherReady || busyAction !== null}>
                    {busyAction === "load" ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />} 加载到画布
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 flex-1 text-xs" onClick={handleSyncFromCanvas} disabled={!ketcherReady || busyAction !== null}>
                    {busyAction === "get" ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />} 从画布获取
                  </Button>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-700">快捷示例</label>
                <div className="flex flex-wrap gap-1">
                  {quickSmiles.map((q) => (
                    <button key={q.label} type="button" onClick={() => setSmilesInput(q.value)} className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-700 transition-all hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700">
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-700">查找模式</label>
                <div className="space-y-1.5">
                  <button type="button" onClick={() => setMode("exact")} className={cn("w-full rounded-lg border px-3 py-2 text-left text-xs transition-all", mode === "exact" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 bg-white text-gray-600 hover:border-gray-300")}>
                    <div className="font-semibold">精准查找</div>
                    <div className="mt-0.5 text-[10px] text-gray-500">SMILES 完全一致（默认）</div>
                  </button>
                  <button type="button" onClick={() => setMode("substructure")} className={cn("w-full rounded-lg border px-3 py-2 text-left text-xs transition-all", mode === "substructure" ? "border-cyan-500 bg-cyan-50 text-cyan-700" : "border-gray-200 bg-white text-gray-600 hover:border-gray-300")}>
                    <div className="font-semibold">子结构查找</div>
                    <div className="mt-0.5 text-[10px] text-gray-500">基于 RDKit 化学子结构匹配</div>
                  </button>
                </div>
              </div>

              <Button variant="ghost" size="sm" className="w-full text-xs text-gray-500" onClick={handleClear}>清空画布与输入</Button>

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
          className="flex shrink-0 justify-end gap-2 border-t border-gray-100 px-5 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            submitSearch();
          }}
        >
          <Button variant="outline" size="sm" onClick={onClose}>取消</Button>
          <Button
            size="sm"
            htmlType="submit"
            onClick={(event) => { event.preventDefault(); submitSearch(); }}
            disabled={busyAction !== null}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {busyAction === "search" ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />} 查询
          </Button>
        </form>
      </div>
    </div>
  );
}
