import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { activeRuns, diagnosticAccess, diagnosticAudit, problemCode } from '@/lib/agent/diagnostics';
import { safeTrace } from '@/lib/agent/trace';
export const GET=withErrorHandler(async(request:NextRequest,{params}:{params:Promise<{id:string}>})=>{
 const download=request.nextUrl.searchParams.has('download');const access=await diagnosticAccess(request,download?'export':'content');if(access instanceof NextResponse)return access;
 const {id}=await params;const cursor=request.nextUrl.searchParams.get('cursor');
 const runs=await prisma.assistantRun.findMany({where:{AND:[activeRuns(access.scope),{message:{sessionId:id},purgedAt:null,OR:[{captureContent:true},{shared:true}],expiresAt:{gt:new Date()}}]},orderBy:[{createdAt:'asc'},{id:'asc'}],take:51,...(cursor?{cursor:{id:cursor},skip:1}:{}),select:{id:true,input:true,output:true,createdAt:true,model:true,release:true,status:true,shared:true,captureContent:true}});
 if(!runs.length&&!cursor)return NextResponse.json({error:'没有获准查看且仍在保留期内的会话记录'},{status:404});
 await diagnosticAudit(access.auth.userId,download?'ASSISTANT_SESSION_EXPORT':'ASSISTANT_SESSION_READ',id);
 const messages=runs.slice(0,50).map(run=>{let input:{question?:unknown}={};let answer:unknown=run.output;try{input=JSON.parse(run.input);answer=JSON.parse(run.output);}catch{}return{...run,input:undefined,output:undefined,question:input.question??'[未采集]',answer,problemCode:problemCode(run.id)};});
 return NextResponse.json({sessionId:id,messages:safeTrace(messages),nextCursor:runs.length>50?runs[49].id:null,scope:'仅包含授权且未过期的已采集或明确共享轮次，不补录此前未采集的上下文'},{headers:{'Cache-Control':'no-store',...(download?{'Content-Disposition':`attachment; filename="conversation-${id}.json"`}:{})}});
});
