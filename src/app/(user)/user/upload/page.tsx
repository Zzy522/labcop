"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ReagentStockInContent } from "@/components/reagents/reagent-stock-in-content";

export default function UserUploadPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-gray-400" /></div>}>
      <UserUploadPageInner />
    </Suspense>
  );
}

function UserUploadPageInner() {
  const searchParams = useSearchParams();
  const requestedMode = searchParams.get('mode');
  const initialMode = requestedMode === 'manual' || requestedMode === 'archive' ? requestedMode : 'photo';
  return <ReagentStockInContent initialMode={initialMode} initialReview={searchParams.get('review') === '1'} />;
}
