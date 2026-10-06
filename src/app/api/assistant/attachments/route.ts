import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { saveAssistantAttachment } from '@/lib/assistant-attachments';
import { checkRateLimit } from '@/lib/rate-limit';

export const POST = withErrorHandler(async (request: NextRequest) => {
  const auth = await requireAuth(request);
  if (!isUserContext(auth)) return auth;
  if (!auth.labId) return NextResponse.json({ error: '请先加入实验室' }, { status: 403 });
  if (!checkRateLimit(`${auth.userId}:document-upload`, { capacity: 5, refillPerSec: 1 / 30 }).allowed) return NextResponse.json({ error: '上传过于频繁，请稍后重试' }, { status: 429 });
  if (Number(request.headers.get('content-length')) > 11 * 1024 * 1024) return NextResponse.json({ error: '文件不能超过 10MB' }, { status: 413 });
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: '请选择文件' }, { status: 400 });
  const result = await saveAssistantAttachment(file, auth.userId, auth.labId);
  return NextResponse.json({ data: { id: result.id, name: result.name, characters: result.text.length, warning: result.warning + (result.text.length > 12000 ? '本轮对话将读取正文前 12000 字符，请拆分长文档以阅读全文。' : '') } }, { status: 201 });
});
