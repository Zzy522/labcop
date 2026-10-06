'use client';

import { useState, useRef } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Upload, Download, Loader2, CheckCircle2, AlertCircle, FileUp } from 'lucide-react';
import { authFetch } from '@/lib/auth-fetch';

interface ImportResult {
  success: number;
  total: number;
  failed: number;
  failures: Array<{ row: number; error: string }>;
}

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  templateUrl: string;
  importUrl: string;
  /** 导入成功后回调（通常用于刷新列表） */
  onImported?: () => void;
}

/**
 * 通用 CSV 批量导入对话框
 *
 * - 下载模板（CSV，含表头与示例）
 * - 选择文件并解析为文本
 * - 上传后展示成功/失败明细
 */
export function ImportDialog({
  open, onOpenChange, title, templateUrl, importUrl, onImported,
}: ImportDialogProps) {
  const [fileName, setFileName] = useState('');
  const [fileText, setFileText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFileName('');
    setFileText('');
    setResult(null);
    setError('');
  };

  const handleDownload = async () => {
    try {
      const res = await authFetch(templateUrl);
      if (!res.ok) throw new Error('下载失败');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = templateUrl.includes('reagents') ? 'reagents-template.csv' : 'compounds-template.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : '下载模板失败');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);
    setError('');
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setFileText(String(ev.target?.result || ''));
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  const handleImport = async () => {
    if (!fileText.trim()) {
      setError('请先选择 CSV 文件');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await authFetch(importUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: fileText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '导入失败');
      setResult(data.data);
      if (data.data.success > 0) onImported?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="size-4 text-cyan-600" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 步骤说明 + 模板下载 */}
          <div className="rounded-md bg-cyan-50 p-3 text-xs text-cyan-800">
            <p className="mb-2 font-medium">使用步骤：</p>
            <ol className="list-decimal space-y-1 pl-4">
              <li>下载 CSV 模板，按表头填写数据（勿改表头）</li>
              <li>选择已填好的 CSV 文件</li>
              <li>点击「开始导入」，查看导入结果</li>
            </ol>
          </div>

          <Button type="button" variant="outline" size="sm" onClick={handleDownload}>
            <Download className="size-4" />
            下载导入模板
          </Button>

          {/* 文件选择 */}
          <div className="space-y-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
            >
              <FileUp className="size-4" />
              选择 CSV 文件
            </Button>
            {fileName && (
              <p className="text-xs text-gray-600">
                已选择：<span className="font-medium">{fileName}</span>
              </p>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* 导入结果 */}
          {result && (
            <div className="space-y-2">
              <div
                className={`flex items-center gap-2 rounded-md p-3 text-sm ${
                  result.failed === 0
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-amber-50 text-amber-700'
                }`}
              >
                <CheckCircle2 className="size-4" />
                <span>
                  共 {result.total} 行：成功 {result.success} 行
                  {result.failed > 0 && `，失败 ${result.failed} 行`}
                </span>
              </div>
              {result.failures.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-md border border-gray-200 p-2">
                  <ul className="space-y-1 text-xs">
                    {result.failures.map((f, idx) => (
                      <li key={idx} className="text-red-600">
                        第 {f.row} 行：{f.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={loading}>
            关闭
          </Button>
          <Button
            onClick={handleImport}
            disabled={loading || !fileText.trim()}
            className="bg-cyan-600 hover:bg-cyan-700"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            开始导入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
