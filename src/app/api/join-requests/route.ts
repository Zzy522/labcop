import { NextResponse } from 'next/server';

/** @deprecated 新账号必须在公开注册时生成 RegistrationApplication。 */
export async function POST() {
  return NextResponse.json({ error: '旧入组申请入口已关闭，请退出登录后从“提交账号申请”进入审批流程' }, { status: 410 });
}
