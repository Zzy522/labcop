import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { runPaddleOCR } from '@/lib/ai/paddleocr-server';
import { toAppError, AppError, ErrorCategory } from '@/lib/errors';
import { checkRateLimit, RATE_LIMIT_PRESETS } from '@/lib/rate-limit';

/**
 * POST /api/ocr/stream
 * 流式 OCR 接口（SSE：Server-Sent Events）
 *
 * 设计目标：
 * - 替代 /api/ocr 的"黑盒"等待（最长 120s 无反馈）
 * - 通过 SSE 实时推送进度：submitting → polling → processing → done/error
 * - 前端可展示进度条/状态文案，提升体验
 *
 * SSE 事件格式：
 *   data: {"stage":"submitting"}\n\n
 *   data: {"stage":"polling","jobId":"xxx"}\n\n
 *   data: {"stage":"processing","state":"running","elapsedMs":3000}\n\n
 *   data: {"stage":"done","text":"...","rawText":"..."}\n\n
 *   data: {"stage":"error","category":"UPSTREAM_ERROR","message":"...","actionUrl":"..."}\n\n
 *
 * 客户端用法：
 *   const eventSource = new EventSource('/api/ocr/stream?fileId=xxx');
 *   eventSource.onmessage = (e) => { const data = JSON.parse(e.data); ... };
 *
 * 注意：EventSource 只支持 GET，故本接口用 GET + 文件在服务端临时缓存的方式
 *      （MVP 简化：直接用 POST + ReadableStream，前端用 fetch + ReadableStream 读取）
 */

export const POST = async (request: NextRequest) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;

  // 速率限制（per-user，OCR 成本高）
  const rl = checkRateLimit(`${authResult.userId}:ocr`, RATE_LIMIT_PRESETS.ocr);
  if (!rl.allowed) {
    return new NextResponse(
      JSON.stringify({ error: `OCR 请求过于频繁，请 ${Math.ceil(rl.retryAfterMs / 1000)} 秒后再试`, category: 'QUOTA_EXCEEDED' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const formData = await request.formData();
  const file = formData.get('file');
  if (!file || !(file instanceof File)) {
    return new Response(JSON.stringify({ error: '请上传图片文件' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // SSE 流
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // 阶段 1：提交任务
        send({ stage: 'submitting', fileName: file.name, fileSize: file.size });

        // 注意：runPaddleOCR 是黑盒，无法直接获取内部进度
        // 这里用"心跳"模拟进度反馈：每隔 3s 推送一次"仍在处理中"
        let elapsedMs = 0;
        const heartbeat = setInterval(() => {
          elapsedMs += 3000;
          send({ stage: 'processing', elapsedMs, hint: elapsedMs > 30000 ? '识别耗时较长，请耐心等待' : undefined });
        }, 3000);

        try {
          const result = await runPaddleOCR(file, {
            labId: authResult.labId,
            userId: authResult.userId,
          });
          clearInterval(heartbeat);
          send({ stage: 'done', text: result.text, rawText: result.rawText, elapsedMs });
        } catch (err) {
          clearInterval(heartbeat);
          throw err;
        }
      } catch (err) {
        const appError = toAppError(err);
        send({
          stage: 'error',
          category: appError.category,
          message: appError.message,
          actionUrl: appError.options.actionUrl,
          actionText: appError.options.actionText,
          retryable: appError.isRetryable,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // 禁用 Next.js 的响应缓冲，确保 SSE 实时推送
      'X-Accel-Buffering': 'no',
    },
  });
};
