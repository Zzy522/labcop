import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('邮箱格式不正确'),
  password: z.string().min(1, '密码不能为空'),
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * 注册 Schema
 * - ADMIN：需填 labName + labLocation（创建新实验室）
 * - MEMBER：可选填 joinCode（凭码申请加入）或 labId（搜索后选定），可不填（注册后单独申请）
 * - 邮箱验证码：code（6 位）+ verifyToken（前端从 /api/auth/send-code 获取）
 */
export const registerSchema = z.object({
  name: z.string().trim().min(1, '姓名不能为空').max(50, '姓名过长'),
  email: z.string().trim().toLowerCase().email('邮箱格式不正确'),
  phone: z.string().trim().regex(/^\+?[0-9\-\s()]{6,24}$/, '手机号格式不正确'),
  password: z.string().min(12, '密码至少 12 位').max(100, '密码过长'),
  accountType: z.enum(['LAB_ADMIN', 'LAB_MEMBER']),
  institutionType: z.enum(['UNIVERSITY', 'ENTERPRISE']),
  schoolName: z.string().trim().max(100).optional(),
  collegeName: z.string().trim().max(100).optional(),
  academicIdentity: z.enum(['TEACHER', 'STUDENT']).optional(),
  companyName: z.string().trim().max(120).optional(),
  companyIdentity: z.string().trim().max(100).optional(),
  // 邮箱验证码
  code: z.string().length(6, '验证码为 6 位数字'),
  verifyToken: z.string().min(1, '请先获取验证码'),
  // ADMIN 必填
  labName: z.string().optional(),
  labLocation: z.string().optional(),
  labSchool: z.string().optional(), // 旧客户端兼容，服务端不采信
  labCollege: z.string().optional(), // 旧客户端兼容，服务端不采信
  // MEMBER 可选
  joinCode: z.string().optional(),
  labId: z.string().optional(),
  message: z.string().trim().max(500, '申请留言过长').optional(),
}).superRefine((data, ctx) => {
  if (data.institutionType === 'UNIVERSITY') {
    if (!data.schoolName) ctx.addIssue({ code: 'custom', path: ['schoolName'], message: '请填写学校' });
    if (!data.collegeName) ctx.addIssue({ code: 'custom', path: ['collegeName'], message: '请填写学院' });
    if (!data.academicIdentity) ctx.addIssue({ code: 'custom', path: ['academicIdentity'], message: '请选择高校身份' });
  } else {
    if (!data.companyName) ctx.addIssue({ code: 'custom', path: ['companyName'], message: '请填写企业名称' });
    if (!data.companyIdentity) ctx.addIssue({ code: 'custom', path: ['companyIdentity'], message: '请填写企业身份' });
  }
  if (data.accountType === 'LAB_ADMIN' && !data.joinCode && (!data.labName || !data.labLocation)) {
    ctx.addIssue({ code: 'custom', path: ['labName'], message: '创建实验室需填写名称和位置，加入已有实验室则填写加入码' });
  }
  if (data.accountType === 'LAB_MEMBER' && !data.joinCode && !data.labId) {
    ctx.addIssue({ code: 'custom', path: ['joinCode'], message: '实验员必须选择或填写要加入的实验室' });
  }
});

export type RegisterInput = z.infer<typeof registerSchema>;

/** 发送邮箱验证码 Schema（含图形验证码） */
export const sendCodeSchema = z.object({
  email: z.string().trim().toLowerCase().email('邮箱格式不正确'),
  captchaId: z.string().min(1, '图形验证码缺失'),
  captchaCode: z.string().min(1, '请输入图形验证码'),
});

export type SendCodeInput = z.infer<typeof sendCodeSchema>;

// ─── 邮箱验证 / 密码重置 ───
export const verifyEmailSchema = z.object({
  token: z.string().min(1, '令牌不能为空'),
});

export const emailSchema = z.object({
  email: z.string().trim().toLowerCase().email('邮箱格式不正确'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, '令牌不能为空'),
  password: z.string().min(12, '密码至少 12 位').max(100, '密码过长'),
});
