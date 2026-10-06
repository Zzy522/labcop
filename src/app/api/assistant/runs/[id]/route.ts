import { NextRequest } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { getDiagnosticRun } from '@/lib/agent/diagnostics';
// Compatibility endpoint: server authorization is identical to the platform endpoint.
export const GET = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => getDiagnosticRun(request, (await params).id));
