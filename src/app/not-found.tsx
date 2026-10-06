import Link from 'next/link';
import { Compass, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-teal-100">
        <Compass className="size-8 text-teal-600" />
      </div>
      <h2 className="mt-4 text-xl font-semibold text-gray-900">页面不存在</h2>
      <p className="mt-2 max-w-md text-sm text-gray-500">
        抱歉，您访问的页面不存在或已被移除。
      </p>
      <div className="mt-6">
        <Link href="/">
          <Button>
            <Home className="size-4" />
            返回首页
          </Button>
        </Link>
      </div>
    </div>
  );
}
