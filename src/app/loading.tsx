import { Loader2 } from 'lucide-react';

export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="size-8 animate-spin text-teal-600" />
        <p className="text-sm text-gray-500">加载中...</p>
      </div>
    </div>
  );
}
