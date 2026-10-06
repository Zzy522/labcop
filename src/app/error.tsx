'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('页面错误:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-red-100">
        <AlertTriangle className="size-8 text-red-600" />
      </div>
      <h2 className="mt-4 text-xl font-semibold text-gray-900">页面加载失败</h2>
      <p className="mt-2 max-w-md text-sm text-gray-500">
        抱歉，页面在加载过程中遇到问题。可以尝试重新加载，或返回首页继续操作。
      </p>
      {error?.message && (
        <p className="mt-2 max-w-md break-all rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-400">
          错误详情：{error.message}
        </p>
      )}
      <div className="mt-6 flex items-center gap-3">
        <Button onClick={reset}>
          <RefreshCw className="size-4" />
          重新加载
        </Button>
        <Button variant="outline" onClick={() => (window.location.href = '/')}>
          <Home className="size-4" />
          返回首页
        </Button>
      </div>
    </div>
  );
}
