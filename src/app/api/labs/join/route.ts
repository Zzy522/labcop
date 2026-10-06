import { NextResponse } from 'next/server';

/** @deprecated 禁止已激活账号绕过注册审批另行入组。 */
export async function GET() {
  return NextResponse.json({ data: { status: 'MIGRATED', message: '账号与实验室关系已迁移至 LabMembership' } });
}
export async function POST() {
  return NextResponse.json({ error: '旧加入入口已关闭，请使用注册申请流程' }, { status: 410 });
}
