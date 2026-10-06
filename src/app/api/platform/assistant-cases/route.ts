import { NextRequest, NextResponse } from 'next/server';
import { activeRuns, diagnosticAccess, diagnosticAudit } from '@/lib/agent/diagnostics';
import { z } from 'zod';
import { safeTrace } from '@/lib/agent/trace';
import { withErrorHandler } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';

export const GET = withErrorHandler(async (request: NextRequest) => {
  const access = await diagnosticAccess(request);
  if (access instanceof NextResponse) return access;
  const cursor = request.nextUrl.searchParams.get('cursor');
  const cases = await prisma.assistantCase.findMany({
    where: { run: activeRuns(access.scope) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 51,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, runId: true, category: true, status: true, createdAt: true, run: { select: { release: true, model: true, durationMs: true, status: true } } },
  });
  return NextResponse.json({ cases: cases.slice(0, 50), nextCursor: cases.length > 50 ? cases[49].id : null }, { headers: { 'Cache-Control': 'no-store' } });
});

export const POST=withErrorHandler(async(request:NextRequest)=>{
 const access=await diagnosticAccess(request,'content');if(access instanceof NextResponse)return access;
 const body=z.object({runId:z.string().min(1),category:z.enum(['WRONG_ANSWER','MISSING_CONTEXT','TOOL_ERROR','SLOW','OTHER']).default('OTHER'),note:z.string().max(2000).default('团队标记')}).safeParse(await request.json());
 if(!body.success)return NextResponse.json({error:'案例格式不正确'},{status:400});
 const run=await prisma.assistantRun.findFirst({where:{AND:[activeRuns(access.scope),{id:body.data.runId,purgedAt:null,expiresAt:{gt:new Date()}}]}});
 if(!run)return NextResponse.json({error:'运行不存在或已过期'},{status:404});
 const row=await prisma.assistantCase.upsert({where:{runId:run.id},create:{...body.data,note:String(safeTrace(body.data.note))},update:{}});
 await diagnosticAudit(access.auth.userId,'ASSISTANT_CASE_CREATE',run.id);
 return NextResponse.json({caseId:row.id});
});
