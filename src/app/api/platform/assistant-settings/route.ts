import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformAdmin, isUserContext } from '@/lib/auth-middleware';
import { withErrorHandler } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { platformAuditData } from '@/lib/platform-audit';
const policySchema = z.object({ kind: z.literal('policy'), labId: z.string().min(1), enabled: z.boolean(), retentionDays: z.number().int().min(1).max(90), expiresAt: z.string().datetime().nullable(), noticeAcknowledged: z.boolean().default(false) });
const grantSchema = z.object({ kind: z.literal('grant'), userId: z.string().min(1), enabled: z.boolean(), canReadContent: z.boolean(), canExport: z.boolean(), labIds: z.array(z.string().min(1)).max(100) });
export const GET = withErrorHandler(async (request: NextRequest) => {
 const auth = await requirePlatformAdmin(request); if (!isUserContext(auth)) return auth;
 const [policies, grants, labs, developers] = await Promise.all([prisma.assistantDiagnosticPolicy.findMany(),prisma.assistantDiagnosticGrant.findMany(),prisma.lab.findMany({ where: { status: { not: 'DELETED' } },select: {id:true,name:true} }),prisma.user.findMany({where:{platformRole:'PLATFORM_ADMIN',status:'ACTIVE'},select:{id:true,name:true,email:true}})]);
 return NextResponse.json({policies,grants,labs,developers,currentUserId:auth.userId},{headers:{'Cache-Control':'no-store'}});
});
export const PUT = withErrorHandler(async (request: NextRequest) => {
 const auth = await requirePlatformAdmin(request); if (!isUserContext(auth)) return auth;
 const body = z.discriminatedUnion('kind',[policySchema,grantSchema]).safeParse(await request.json());
 if(!body.success) return NextResponse.json({error:'配置格式不正确'},{status:400});
 const b=body.data;
 if(b.kind==='policy') {
  if(b.enabled && (!b.noticeAcknowledged || !b.expiresAt || new Date(b.expiresAt)<=new Date() || new Date(b.expiresAt).getTime()>Date.now()+90*86400000))return NextResponse.json({error:'开启完整采集须确认已告知测试成员，并设置未来 90 天内的结束时间'},{status:400});
  if(!await prisma.lab.findFirst({where:{id:b.labId,status:{not:'DELETED'}}}))return NextResponse.json({error:'实验室不存在'},{status:404});
  const data={enabled:b.enabled,retentionDays:b.retentionDays,expiresAt:b.expiresAt?new Date(b.expiresAt):null,updatedBy:auth.userId};
  await prisma.$transaction([prisma.assistantDiagnosticPolicy.upsert({where:{labId:b.labId},create:{labId:b.labId,...data},update:data}),prisma.platformAuditLog.create({data:platformAuditData({operatorId:auth.userId,action:'DIAGNOSTIC_POLICY_UPDATE',targetType:'Lab',targetId:b.labId,after:data})})]);
 } else {
  if(!await prisma.user.findFirst({where:{id:b.userId,platformRole:'PLATFORM_ADMIN',status:'ACTIVE'}}))return NextResponse.json({error:'只能给有效的平台开发者授权'},{status:400});
  if(await prisma.lab.count({where:{id:{in:b.labIds}}})!==new Set(b.labIds).size)return NextResponse.json({error:'实验室范围不正确'},{status:400});
  const data={canReadContent:b.canReadContent,canExport:b.canExport&&b.canReadContent,labIds:JSON.stringify([...new Set(b.labIds)])};
  await prisma.$transaction([b.enabled?prisma.assistantDiagnosticGrant.upsert({where:{userId:b.userId},create:{userId:b.userId,...data},update:data}):prisma.assistantDiagnosticGrant.deleteMany({where:{userId:b.userId}}),prisma.platformAuditLog.create({data:platformAuditData({operatorId:auth.userId,action:'DIAGNOSTIC_GRANT_UPDATE',targetType:'User',targetId:b.userId,after:b})})]);
 }
 return NextResponse.json({ok:true});
});
