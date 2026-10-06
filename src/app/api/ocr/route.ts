import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { runPaddleOCR } from '@/lib/ai/paddleocr-server';
import { checkRateLimit, RATE_LIMIT_PRESETS } from '@/lib/rate-limit';

/**
 * POST /api/ocr
 * 接收图片文件，调用 PaddleOCR-VL-1.6 服务，返回识别的 Markdown 文本。
 *
 * 此路由为客户端直接调用 OCR 的入口（如未来移动端拍照识别）。
 * 服务端内部（如 documents/upload）应直接调用 runPaddleOCR，不通过 HTTP。
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;

  // 速率限制（per-user，OCR 成本高）
  const rl = checkRateLimit(`${authResult.userId}:ocr`, RATE_LIMIT_PRESETS.ocr);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `OCR 请求过于频繁，请 ${Math.ceil(rl.retryAfterMs / 1000)} 秒后再试`, category: 'QUOTA_EXCEEDED' },
      { status: 429 }
    );
  }

  const formData = await request.formData();
  const file = formData.get('file');
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: '请上传图片文件' }, { status: 400 });
  }

  try {
    const result = await runPaddleOCR(file, {
      labId: authResult.labId,
      userId: authResult.userId,
    });
    return NextResponse.json({ data: { text: result.text, rawText: result.rawText } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'OCR 识别失败';
    // 根据错误内容返回合适的 status
    const isConfigError = message.includes('尚未配置');
    const isFileError = message.includes('图片') || message.includes('文件类型');
    const status = isConfigError || isFileError ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
});
