import { NextResponse } from 'next/server';
import { getMaintenanceSnapshot } from '@/lib/maintenance';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { data: await getMaintenanceSnapshot() },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
