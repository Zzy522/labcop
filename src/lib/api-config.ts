import { DEFAULT_MODEL, DEFAULT_VLM_MODEL } from '@/lib/model-defaults';
export { DEFAULT_PROVIDER, DEFAULT_MODEL, DEFAULT_VLM_PROVIDER, DEFAULT_VLM_MODEL } from '@/lib/model-defaults';
import type { PrismaClient } from '@/generated/prisma/client';
import { decryptCredential } from '@/lib/crypto';

// LLM 提供商配置
export interface LlmProviderConfig {
  label: string;
  baseUrl: string;
  models: Array<{ value: string; label: string }>;
  /** 是否需要用户填写 baseUrl（阿里云百炼每个工作空间地址不同） */
  requireCustomBaseUrl?: boolean;
  /** 是否需要用户自定义模型名（阿里云百炼模型多且可自定义） */
  requireCustomModel?: boolean;
  /** baseUrl 格式提示 */
  baseUrlHint?: string;
  /** 是否为默认服务商 */
  isDefault?: boolean;
}

export const LLM_PROVIDERS: Record<string, LlmProviderConfig> = {
  deepseek: {
    label: 'DeepSeek',
    // DeepSeek 官方 OpenAI 兼容端点
    baseUrl: 'https://api.deepseek.com',
    models: [
      { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash（快速）' },
      { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro（专业）' },
    ],
    isDefault: true,
  },
  aliyun: {
    label: '阿里云百炼',
    // 每个用户工作空间地址不同，需用户自行填写
    baseUrl: '',
    models: [],
    requireCustomBaseUrl: true,
    requireCustomModel: true,
    baseUrlHint: '格式：https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com',
  },
};

// ─── VLM 视觉模型服务商（图片/PPT/谱图/实验照片理解） ───
// 设计：常规对话/查表用 LLM（service='llm'），仅图像理解用 VLM（service='vlm'），降低延迟与成本
export const VLM_PROVIDERS: Record<string, LlmProviderConfig> = {
  zhipu: {
    label: '智谱 GLM-4V（推荐）',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      { value: 'glm-4v-plus', label: 'GLM-4V Plus' },
      { value: 'glm-4v', label: 'GLM-4V' },
      { value: 'glm-4v-flash', label: 'GLM-4V Flash（快/省）' },
    ],
    isDefault: true,
  },
  aliyun_vl: {
    label: '阿里云百炼 通义千问 VL',
    baseUrl: '',
    models: [
      { value: 'qwen-vl-max', label: 'Qwen-VL Max' },
      { value: 'qwen-vl-plus', label: 'Qwen-VL Plus' },
    ],
    requireCustomBaseUrl: true,
    requireCustomModel: false,
    baseUrlHint: '格式：https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com',
  },
  openai: {
    label: 'OpenAI GPT-4o',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-4o-mini', label: 'GPT-4o mini（快/省）' },
    ],
  },
  custom: {
    label: '自定义（OpenAI 兼容）',
    baseUrl: '',
    models: [],
    requireCustomBaseUrl: true,
    requireCustomModel: true,
    baseUrlHint: '填写你的 OpenAI 兼容 vision API 地址，如 https://your-domain/v1（需支持 image_url 视觉输入）',
  },
};

/**
 * 规范化 LLM/VLM baseUrl
 * 阿里云百炼用户填写格式：https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com
 * OpenAI 兼容端点需补 /compatible-mode/v1 后缀
 * 注意：provider 可能来自 VLM_PROVIDERS（zhipu/aliyun_vl/openai/custom），需两处都查，
 * 否则 VLM 提供商会错误回退到 OpenAI 默认地址。
 */
function resolveBaseUrl(provider: string, savedBaseUrl: string | null | undefined): string {
  const providerCfg = LLM_PROVIDERS[provider] || VLM_PROVIDERS[provider];
  if (provider === 'aliyun' || provider === 'aliyun_vl') {
    if (!savedBaseUrl) return '';
    const clean = savedBaseUrl.replace(/\/$/, '');
    return clean.endsWith('/compatible-mode/v1') ? clean : `${clean}/compatible-mode/v1`;
  }
  return savedBaseUrl || providerCfg?.baseUrl || 'https://api.openai.com/v1';
}

// OCR 配置
export const OCR_CONFIG = {
  paddleocr: {
    label: 'PaddleOCR-VL-1.6',
    jobUrl: 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs',
    model: 'PaddleOCR-VL-1.6',
  },
};

/**
 * 获取用户有效的 LLM 配置
 * 优先级：个人配置 > 实验室统一配置 > 环境变量
 * 注：数据库中的 apiKey 为加密存储，读取时解密；环境变量为明文配置无需解密。
 */
export async function getEffectiveLlmConfig(
  labId: string | undefined,
  userId: string,
  prisma: PrismaClient
): Promise<{ apiKey: string; baseUrl: string; model: string; source: string } | null> {
  if (!labId) {
    // 无 labId 时尝试环境变量
    const envKey = process.env.OPENAI_API_KEY;
    if (envKey) {
      return {
        apiKey: envKey,
        baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        source: 'env',
      };
    }
    return null;
  }

  // 1. 个人配置
  const personal = await prisma.apiCredential.findFirst({
    where: { labId, userId, service: 'llm', isActive: true },
  });
  if (personal) {
    const providerCfg = LLM_PROVIDERS[personal.provider];
    const baseUrl = resolveBaseUrl(personal.provider, personal.baseUrl);
    return {
      apiKey: decryptCredential(personal.apiKey),
      baseUrl,
      model: personal.model || providerCfg?.models[0]?.value || DEFAULT_MODEL,
      source: 'personal',
    };
  }

  // 2. 实验室统一配置
  const labLevel = await prisma.apiCredential.findFirst({
    where: { labId, userId: null, service: 'llm', isActive: true },
  });
  if (labLevel) {
    const providerCfg = LLM_PROVIDERS[labLevel.provider];
    const baseUrl = resolveBaseUrl(labLevel.provider, labLevel.baseUrl);
    return {
      apiKey: decryptCredential(labLevel.apiKey),
      baseUrl,
      model: labLevel.model || providerCfg?.models[0]?.value || DEFAULT_MODEL,
      source: 'lab',
    };
  }

  // 3. 环境变量
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey) {
    return {
      apiKey: envKey,
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      source: 'env',
    };
  }

  return null;
}

/**
 * 获取用户有效的 VLM（视觉模型）配置
 * 优先级：个人 vlm 配置 > 实验室 vlm 配置。
 * 图片理解必须显式配置 VLM，避免把图片误发给纯文本 LLM 后得到“无法查看图片”的错误回答。
 * 注：数据库中的 apiKey 为加密存储，读取时解密。
 */
export async function getEffectiveVlmConfig(
  labId: string | undefined,
  userId: string,
  prisma: PrismaClient
): Promise<{ apiKey: string; baseUrl: string; model: string; source: string } | null> {
  if (!labId) return null;

  // 1. 个人 VLM 配置
  const personal = await prisma.apiCredential.findFirst({
    where: { labId, userId, service: 'vlm', isActive: true },
  });
  if (personal) {
    const baseUrl = resolveBaseUrl(personal.provider, personal.baseUrl);
    return {
      apiKey: decryptCredential(personal.apiKey),
      baseUrl,
      model: personal.model || VLM_PROVIDERS[personal.provider]?.models[0]?.value || DEFAULT_VLM_MODEL,
      source: 'personal-vlm',
    };
  }

  // 2. 实验室 VLM 配置
  const labLevel = await prisma.apiCredential.findFirst({
    where: { labId, userId: null, service: 'vlm', isActive: true },
  });
  if (labLevel) {
    const baseUrl = resolveBaseUrl(labLevel.provider, labLevel.baseUrl);
    return {
      apiKey: decryptCredential(labLevel.apiKey),
      baseUrl,
      model: labLevel.model || VLM_PROVIDERS[labLevel.provider]?.models[0]?.value || DEFAULT_VLM_MODEL,
      source: 'lab-vlm',
    };
  }

  return null;
}

/**
 * 获取用户有效的 OCR Token
 * 优先级：个人配置 > 实验室统一配置
 */
export async function getEffectiveOcrToken(
  labId: string | undefined,
  userId: string,
  prisma: PrismaClient
): Promise<{ token: string; source: string } | null> {
  if (!labId) return null;

  // 1. 个人配置
  const personal = await prisma.apiCredential.findFirst({
    where: { labId, userId, service: 'ocr', isActive: true },
  });
  if (personal) {
    return { token: decryptCredential(personal.apiKey), source: 'personal' };
  }

  // 2. 实验室统一配置
  const labLevel = await prisma.apiCredential.findFirst({
    where: { labId, userId: null, service: 'ocr', isActive: true },
  });
  if (labLevel) {
    return { token: decryptCredential(labLevel.apiKey), source: 'lab' };
  }

  return null;
}
