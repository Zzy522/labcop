import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { LLM_PROVIDERS, VLM_PROVIDERS, OCR_CONFIG } from '@/lib/api-config';
import { encryptCredential } from '@/lib/crypto';
import { assertSafeExternalUrl } from '@/lib/url-security';

/** GET /api/llm-config/lab - 获取实验室统一 LLM + OCR 配置（管理员） */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;

  const [llmConfig, ocrConfig, vlmConfig] = await Promise.all([
    prisma.apiCredential.findFirst({
      where: { labId: authResult.labId, userId: null, service: 'llm', isActive: true },
    }),
    prisma.apiCredential.findFirst({
      where: { labId: authResult.labId, userId: null, service: 'ocr', isActive: true },
    }),
    prisma.apiCredential.findFirst({
      where: { labId: authResult.labId, userId: null, service: 'vlm', isActive: true },
    }),
  ]);

  return NextResponse.json({
    data: {
      llm: llmConfig
        ? { provider: llmConfig.provider, model: llmConfig.model, hasApiKey: true, baseUrl: llmConfig.baseUrl }
        : null,
      vlm: vlmConfig
        ? { provider: vlmConfig.provider, model: vlmConfig.model, hasApiKey: true, baseUrl: vlmConfig.baseUrl }
        : null,
      ocr: ocrConfig
        ? { provider: ocrConfig.provider, hasApiKey: true }
        : null,
      availableLlmProviders: Object.entries(LLM_PROVIDERS).map(([key, cfg]) => ({
        key, label: cfg.label, models: cfg.models,
        requireCustomBaseUrl: cfg.requireCustomBaseUrl,
        requireCustomModel: cfg.requireCustomModel,
        baseUrlHint: cfg.baseUrlHint,
        isDefault: cfg.isDefault,
      })),
      availableVlmProviders: Object.entries(VLM_PROVIDERS).map(([key, cfg]) => ({
        key, label: cfg.label, models: cfg.models,
        requireCustomBaseUrl: cfg.requireCustomBaseUrl,
        requireCustomModel: cfg.requireCustomModel,
        baseUrlHint: cfg.baseUrlHint,
        isDefault: cfg.isDefault,
      })),
      ocrConfig: { label: OCR_CONFIG.paddleocr.label },
    },
  });
});

/** PUT /api/llm-config/lab - 保存实验室统一 LLM/OCR 配置（管理员） */
export const PUT = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;

  const body = await request.json();
  const { service, provider, apiKey, model, baseUrl } = body;

  if (!service || !provider || !apiKey) {
    return NextResponse.json({ error: '请选择服务类型、服务商并填写 API Key' }, { status: 400 });
  }

  if (service === 'llm' && !LLM_PROVIDERS[provider]) {
    return NextResponse.json({ error: '不支持的 LLM 服务商' }, { status: 400 });
  }
  if (service === 'vlm' && !VLM_PROVIDERS[provider]) {
    return NextResponse.json({ error: '不支持的 VLM 服务商' }, { status: 400 });
  }
  if (service === 'ocr' && provider !== 'paddleocr') {
    return NextResponse.json({ error: '不支持的 OCR 服务商' }, { status: 400 });
  }
  if (!['llm', 'ocr', 'vlm'].includes(service)) {
    return NextResponse.json({ error: '不支持的 service 类型' }, { status: 400 });
  }

  // 自定义 baseUrl/model 校验（llm 阿里云 / vlm 阿里云百炼）
  const providerCfg = service === 'vlm' ? VLM_PROVIDERS[provider] : LLM_PROVIDERS[provider];
  if ((service === 'llm' || service === 'vlm') && providerCfg?.requireCustomBaseUrl && !baseUrl) {
    return NextResponse.json({ error: '请填写 API 网址（工作空间地址）' }, { status: 400 });
  }
  if ((service === 'llm' || service === 'vlm') && providerCfg?.requireCustomModel && !model) {
    return NextResponse.json({ error: '请填写模型名称' }, { status: 400 });
  }
  if (baseUrl) await assertSafeExternalUrl(baseUrl);

  // 删除旧的实验室统一配置（同一 service），创建新的
  await prisma.apiCredential.deleteMany({
    where: { labId: authResult.labId, userId: null, service },
  });

  const credential = await prisma.apiCredential.create({
    data: {
      labId: authResult.labId!,
      userId: null,
      service,
      provider,
      apiKey: encryptCredential(apiKey),
      model:
        model ||
        (service === 'llm'
          ? LLM_PROVIDERS[provider]?.models[0]?.value
          : service === 'vlm'
            ? VLM_PROVIDERS[provider]?.models[0]?.value
            : null),
      baseUrl: baseUrl || null,
      isActive: true,
    },
  });

  return NextResponse.json({ data: { id: credential.id, service, provider } });
});

/** DELETE /api/llm-config/lab - 删除实验室统一配置 */
export const DELETE = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;

  const { searchParams } = new URL(request.url);
  const service = searchParams.get('service') || 'llm';

  if (!['llm', 'ocr', 'vlm'].includes(service)) {
    return NextResponse.json({ error: '不支持的 service 类型' }, { status: 400 });
  }

  await prisma.apiCredential.deleteMany({
    where: { labId: authResult.labId, userId: null, service },
  });

  return NextResponse.json({ data: { deleted: true } });
});
