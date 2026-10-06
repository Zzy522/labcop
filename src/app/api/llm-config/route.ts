import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { LLM_PROVIDERS, VLM_PROVIDERS, OCR_CONFIG } from '@/lib/api-config';
import { encryptCredential } from '@/lib/crypto';
import { assertSafeExternalUrl } from '@/lib/url-security';

/** GET /api/llm-config - 获取当前用户的 LLM + OCR 配置 + 实验室统一配置状态 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;

  // 个人配置（LLM + VLM + OCR）
  const [personalLlm, personalOcr, personalVlm] = await Promise.all([
    prisma.apiCredential.findFirst({
      where: { labId: authResult.labId, userId: authResult.userId, service: 'llm', isActive: true },
    }),
    prisma.apiCredential.findFirst({
      where: { labId: authResult.labId, userId: authResult.userId, service: 'ocr', isActive: true },
    }),
    prisma.apiCredential.findFirst({
      where: { labId: authResult.labId, userId: authResult.userId, service: 'vlm', isActive: true },
    }),
  ]);

  // 实验室统一配置（仅显示是否存在，不返回 apiKey）
  const [labLevelLlm, labLevelOcr, labLevelVlm] = await Promise.all([
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
      personal: {
        llm: personalLlm
          ? { provider: personalLlm.provider, model: personalLlm.model, hasApiKey: true, baseUrl: personalLlm.baseUrl }
          : null,
        vlm: personalVlm
          ? { provider: personalVlm.provider, model: personalVlm.model, hasApiKey: true, baseUrl: personalVlm.baseUrl }
          : null,
        ocr: personalOcr
          ? { provider: personalOcr.provider, hasApiKey: true }
          : null,
      },
      labLevel: {
        llm: labLevelLlm
          ? { provider: labLevelLlm.provider, model: labLevelLlm.model, hasApiKey: true }
          : null,
        vlm: labLevelVlm
          ? { provider: labLevelVlm.provider, model: labLevelVlm.model, hasApiKey: true }
          : null,
        ocr: labLevelOcr
          ? { provider: labLevelOcr.provider, hasApiKey: true }
          : null,
      },
      availableProviders: Object.entries(LLM_PROVIDERS).map(([key, cfg]) => ({
        key,
        label: cfg.label,
        models: cfg.models,
        requireCustomBaseUrl: cfg.requireCustomBaseUrl,
        requireCustomModel: cfg.requireCustomModel,
        baseUrlHint: cfg.baseUrlHint,
        isDefault: cfg.isDefault,
      })),
      availableVlmProviders: Object.entries(VLM_PROVIDERS).map(([key, cfg]) => ({
        key,
        label: cfg.label,
        models: cfg.models,
        requireCustomBaseUrl: cfg.requireCustomBaseUrl,
        requireCustomModel: cfg.requireCustomModel,
        baseUrlHint: cfg.baseUrlHint,
        isDefault: cfg.isDefault,
      })),
      ocrLabel: OCR_CONFIG.paddleocr.label,
    },
  });
});

/** PUT /api/llm-config - 保存个人 LLM 或 OCR 配置 */
export const PUT = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;

  const body = await request.json();
  const { service = 'llm', provider, apiKey, model, baseUrl } = body;

  if (!service || !provider || !apiKey) {
    return NextResponse.json({ error: '请选择服务商并填写 API Key' }, { status: 400 });
  }

  // 校验服务商
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

  // 删除旧的个人配置（同一 service），创建新的
  await prisma.apiCredential.deleteMany({
    where: { labId: authResult.labId, userId: authResult.userId, service },
  });

  const credential = await prisma.apiCredential.create({
    data: {
      labId: authResult.labId!,
      userId: authResult.userId,
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

  return NextResponse.json({ data: { id: credential.id, service, provider, model: credential.model } });
});

/** DELETE /api/llm-config - 删除个人 LLM/OCR 配置（回退到实验室统一配置） */
export const DELETE = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;

  const { searchParams } = new URL(request.url);
  const service = searchParams.get('service') || 'llm';

  if (!['llm', 'ocr', 'vlm'].includes(service)) {
    return NextResponse.json({ error: '不支持的 service 类型' }, { status: 400 });
  }

  await prisma.apiCredential.deleteMany({
    where: { labId: authResult.labId, userId: authResult.userId, service },
  });

  return NextResponse.json({ data: { deleted: true, service } });
});
