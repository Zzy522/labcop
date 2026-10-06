import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ message = '数据加载失败，请重试', onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-red-100 p-4 mb-4 dark:bg-red-900/30">
        <AlertCircle className="size-8 text-red-600 dark:text-red-400" />
      </div>
      <h3 className="text-lg font-semibold text-foreground">加载失败</h3>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" className="mt-4" onClick={onRetry}>
          重试
        </Button>
      )}
    </div>
  );
}
