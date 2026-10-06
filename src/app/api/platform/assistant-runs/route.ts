import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withErrorHandler } from '@/lib/api-utils';
import { activeRuns, diagnosticAccess, parseProblemCode, problemCode } from '@/lib/agent/diagnostics';
import type { Prisma } from '@/generated/prisma/client';
export const GET = withErrorHandler(async (request: NextRequest) => {
 const access = await diagnosticAccess(request); if (access instanceof NextResponse) return access;
 const q = request.nextUrl.searchParams; const search = parseProblemCode((q.get('q') ?? '').slice(0, 150));
 const where: Prisma.AssistantRunWhereInput = { AND: [activeRuns(access.scope), ...(search ? [{ OR: [{ id: search }, { messageId: search }, { userId: search }, { message: { sessionId: search.replace(/^CS-/i, '') } }, { badCase: { id: search } }] }] : [])], ...(q.get('status') ? { status: q.get('status')! } : {}), ...(q.get('labId') ? { labId: q.get('labId')! } : {}), ...(q.get('release') ? { release: { contains: q.get('release')!.slice(0, 80) } } : {}), ...(q.get('cases') === '1' ? { badCase: { isNot: null } } : {}), ...(q.get('slow') === '1' ? { durationMs: { gte: 30000 } } : {}) };
 const cursor = q.get('cursor');
 const rows = await prisma.assistantRun.findMany({ where, take: 51, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, userId: true, labId: true, release: true, model: true, status: true, durationMs: true, createdAt: true, captureContent: true, shared: true, purgedAt: true, expiresAt: true, message: { select: { sessionId: true, feedback: true, session: { select: { user: { select: { name: true } }, lab: { select: { name: true } } } } } }, badCase: { select: { id: true, category: true, status: true } } } });
 return NextResponse.json({ runs: rows.slice(0,50).map(r=>({...r,problemCode:problemCode(r.id),userName:r.message.session.user.name,labName:r.message.session.lab.name})), nextCursor: rows.length > 50 ? rows[49].id : null }, { headers: { 'Cache-Control': 'no-store' } });
});
