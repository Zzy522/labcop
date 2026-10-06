'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/arco-adapters/select';
import { Badge } from '@/components/ui/badge';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import {
  Loader2, KeyRound, Trash2, Save, AlertCircle, CheckCircle2, ScanText, ArrowLeft,
} from 'lucide-react';
import { authFetch } from '@/lib/auth-fetch';
import { DEFAULT_PROVIDER, DEFAULT_MODEL } from '@/lib/model-defaults';
import { VlmConfigCard } from './vlm-config-card';
import { useRouter } from 'next/navigation';

interface ProviderInfo {
  key: string;
  label: string;
  models: Array<{ value: string; label: string }>;
  requireCustomBaseUrl?: boolean;
  requireCustomModel?: boolean;
  baseUrlHint?: string;
  isDefault?: boolean;
}

interface ConfigStatus {
  provider?: string;
  model?: string | null;
  hasApiKey?: boolean;
  baseUrl?: string | null;
}

interface PersonalConfigResponse {
  personal: {
    llm: ConfigStatus | null;
    ocr: ConfigStatus | null;
  };
  labLevel: {
    llm: ConfigStatus | null;
    ocr: ConfigStatus | null;
  };
  availableProviders: ProviderInfo[];
  ocrLabel?: string;
}

interface LabConfigResponse {
  llm: ConfigStatus | null;
  ocr: ConfigStatus | null;
  availableLlmProviders: ProviderInfo[];
  ocrConfig?: { label: string };
}

interface LlmConfigPanelProps {
  /** 'personal' = 实验员/管理员个人配置；'lab' = 管理员实验室统一配置 */
  mode: 'personal' | 'lab';
  /** 配置保存成功后的回调 */
  onSaved?: () => void;
  /** 是否显示返回按钮（独立子页面时为 true） */
  showBackButton?: boolean;
}

/**
 * LLM / OCR API 配置面板
 *
 * - mode='personal'：调用 /api/llm-config，可配置个人 LLM + 个人 OCR Token
 * - mode='lab'：调用 /api/llm-config/lab，配置实验室统一 LLM + OCR
 *
 * 优先级（消费侧）：个人配置 > 实验室统一配置（不再提供本地降级，未配置时直接报错）
 */
export function LlmConfigPanel({ mode, onSaved, showBackButton = false }: LlmConfigPanelProps) {
  const router = useRouter();
  const isLab = mode === 'lab';

  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [personalLlm, setPersonalLlm] = useState<ConfigStatus | null>(null);
  const [personalOcr, setPersonalOcr] = useState<ConfigStatus | null>(null);
  const [labLevelLlm, setLabLevelLlm] = useState<ConfigStatus | null>(null);
  const [labLevelOcr, setLabLevelOcr] = useState<ConfigStatus | null>(null);
  const [ocrLabel, setOcrLabel] = useState('PaddleOCR-VL-1.6');

  // LLM 表单
  const [provider, setProvider] = useState(DEFAULT_PROVIDER);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [baseUrl, setBaseUrl] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  // OCR Token 表单
  const [ocrToken, setOcrToken] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'llm' | 'ocr' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = isLab ? '/api/llm-config/lab' : '/api/llm-config';
      const res = await authFetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || '加载配置失败');

      if (isLab) {
        const payload = data.data as LabConfigResponse;
        setProviders(payload.availableLlmProviders || []);
        setLabLevelLlm(payload.llm || null);
        setLabLevelOcr(payload.ocr || null);
        if (payload.llm?.provider) {
          setProvider(payload.llm.provider);
          setModel(payload.llm.model || '');
          setBaseUrl(payload.llm.baseUrl || '');
        } else {
          setProvider(DEFAULT_PROVIDER);
          setModel(DEFAULT_MODEL);
          setBaseUrl('');
        }
        if (payload.ocrConfig?.label) setOcrLabel(payload.ocrConfig.label);
      } else {
        const payload = data.data as PersonalConfigResponse;
        setProviders(payload.availableProviders || []);
        setPersonalLlm(payload.personal?.llm || null);
        setPersonalOcr(payload.personal?.ocr || null);
        setLabLevelLlm(payload.labLevel?.llm || null);
        setLabLevelOcr(payload.labLevel?.ocr || null);
        if (payload.personal?.llm?.provider) {
          setProvider(payload.personal.llm.provider);
          setModel(payload.personal.llm.model || '');
          setBaseUrl(payload.personal.llm.baseUrl || '');
        } else {
          setProvider(DEFAULT_PROVIDER);
          setModel(DEFAULT_MODEL);
          setBaseUrl('');
        }
        if (payload.ocrLabel) setOcrLabel(payload.ocrLabel);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载配置失败');
    } finally {
      setLoading(false);
    }
  }, [isLab]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // 切换服务商时重置 model/baseUrl/apiKey（不同服务商 key 不通用）
  const handleProviderChange = useCallback((newProvider: string) => {
    setProvider(newProvider);
    const cfg = providers.find((p) => p.key === newProvider);
    if (cfg?.requireCustomModel) {
      setModel('');  // 阿里云需用户自定义模型名
    } else {
      setModel(cfg?.models[0]?.value || DEFAULT_MODEL);  // 预设模型默认第一个
    }
    setBaseUrl('');   // 切换时清空
    setApiKey('');    // 不同服务商 key 不通用，必须清空
    setShowApiKey(false);
  }, [providers]);

  const handleSaveLlm = useCallback(async () => {
    setSaving('llm');
    setError(null);
    setSuccessMsg(null);
    try {
      if (!provider) throw new Error('请选择服务商');
      if (!apiKey.trim()) throw new Error('请填写 API Key');

      const currentProviderCfg = providers.find((p) => p.key === provider);
      // 阿里云百炼需要 baseUrl 和 model
      if (currentProviderCfg?.requireCustomBaseUrl && !baseUrl.trim()) {
        throw new Error('请填写 API 网址');
      }
      if (currentProviderCfg?.requireCustomModel && !model.trim()) {
        throw new Error('请填写模型名称');
      }

      const url = isLab ? '/api/llm-config/lab' : '/api/llm-config';
      const body: Record<string, unknown> = {
        service: 'llm',
        provider,
        apiKey: apiKey.trim(),
        model: model.trim(),
      };
      // 阿里云需要传 baseUrl
      if (currentProviderCfg?.requireCustomBaseUrl) {
        body.baseUrl = baseUrl.trim();
      }

      const res = await authFetch(url, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || '保存失败');

      setSuccessMsg(isLab ? '实验室统一 LLM 配置已保存，对全部成员生效' : '个人 LLM 配置已保存');
      setApiKey('');
      setShowApiKey(false);
      await fetchConfig();
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(null);
    }
  }, [provider, apiKey, model, baseUrl, providers, isLab, fetchConfig, onSaved]);

  const handleDeleteLlm = useCallback(async () => {
    const msg = isLab
      ? '确认删除实验室统一 LLM 配置？删除后成员将无法使用 AI 助手与 OCR 识别功能，需各自配置个人 LLM。'
      : '确认删除个人 LLM 配置？删除后将回退到实验室统一配置。';
    if (!confirm(msg)) return;

    setSaving('llm');
    setError(null);
    setSuccessMsg(null);
    try {
      const url = isLab ? '/api/llm-config/lab?service=llm' : '/api/llm-config?service=llm';
      const res = await authFetch(url, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || '删除失败');

      setSuccessMsg(isLab ? '实验室统一 LLM 配置已删除' : '个人 LLM 配置已删除');
      setProvider(DEFAULT_PROVIDER);
      setModel(DEFAULT_MODEL);
      setApiKey('');
      setBaseUrl('');
      await fetchConfig();
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setSaving(null);
    }
  }, [isLab, fetchConfig, onSaved]);

  const handleSaveOcr = useCallback(async () => {
    setSaving('ocr');
    setError(null);
    setSuccessMsg(null);
    try {
      if (!ocrToken.trim()) throw new Error('请填写 PaddleOCR API Token');

      const url = isLab ? '/api/llm-config/lab' : '/api/llm-config';
      const body = {
        service: 'ocr',
        provider: 'paddleocr',
        apiKey: ocrToken.trim(),
      };

      const res = await authFetch(url, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || '保存失败');

      setSuccessMsg(isLab
        ? 'OCR Token 已保存，全部成员可使用拍照识别功能'
        : '个人 OCR Token 已保存，将优先于实验室统一配置使用'
      );
      setOcrToken('');
      await fetchConfig();
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(null);
    }
  }, [ocrToken, isLab, fetchConfig, onSaved]);

  const handleDeleteOcr = useCallback(async () => {
    const msg = isLab
      ? '确认删除实验室统一 OCR Token？删除后拍照识别将不可用。'
      : '确认删除个人 OCR Token？删除后将回退到实验室统一配置。';
    if (!confirm(msg)) return;

    setSaving('ocr');
    setError(null);
    setSuccessMsg(null);
    try {
      const url = isLab ? '/api/llm-config/lab?service=ocr' : '/api/llm-config?service=ocr';
      const res = await authFetch(url, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || '删除失败');

      setSuccessMsg('OCR Token 已删除');
      setOcrToken('');
      await fetchConfig();
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setSaving(null);
    }
  }, [isLab, fetchConfig, onSaved]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-gray-400" />
        <span className="ml-2 text-sm text-gray-500">加载配置...</span>
      </div>
    );
  }

  // 当前 LLM 配置
  const currentLlm = isLab ? labLevelLlm : personalLlm;
  const currentOcr = isLab ? labLevelOcr : personalOcr;

  const providerOptions = providers.map((p) => ({ value: p.key, label: p.label }));
  const currentProvider = providers.find((p) => p.key === provider);
  const modelOptions = currentProvider?.models.map((m) => ({ value: m.value, label: m.label })) || [];

  return (
    <div className="space-y-6">
      {showBackButton && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.back()}
        >
          <ArrowLeft className="size-4" />
          返回
        </Button>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {successMsg && (
        <div className="flex items-start gap-2 rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* LLM 配置卡片 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4 text-teal-600" />
            LLM API 配置
          </CardTitle>
          <CardDescription>
            默认 DeepSeek（V4 Flash / Pro），也支持阿里云百炼（需填写工作空间地址与模型名）
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 当前配置状态 */}
          <div className="rounded-md bg-gray-50 p-3">
            <div className="mb-1.5 text-xs font-medium text-gray-500">
              当前{isLab ? '实验室统一' : '个人'} LLM 配置
            </div>
            {currentLlm?.hasApiKey ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="outline" className="border-teal-500 text-teal-700">
                  {providers.find((p) => p.key === currentLlm.provider)?.label || currentLlm.provider}
                </Badge>
                {currentLlm.model && (
                  <Badge variant="outline" className="text-gray-600">
                    {providers.find((p) => p.key === currentLlm.provider)?.models.find((m) => m.value === currentLlm.model)?.label || currentLlm.model}
                  </Badge>
                )}
                <span className="text-xs text-emerald-600">● 已配置</span>
              </div>
            ) : (
              <div className="text-sm text-gray-500">
                {isLab ? '尚未配置实验室统一 LLM API' : '尚未配置个人 LLM API'}
                {!isLab && labLevelLlm?.hasApiKey && (
                  <span className="ml-2 text-xs text-teal-600">（已使用实验室统一配置）</span>
                )}
              </div>
            )}
            {!isLab && labLevelLlm?.hasApiKey && (
              <div className="mt-2 text-xs text-gray-500">
                实验室统一配置：
                <Badge variant="outline" className="ml-1 text-gray-600">
                  {providers.find((p) => p.key === labLevelLlm.provider)?.label || labLevelLlm.provider}
                </Badge>
                <span className="ml-1 text-teal-600">可用</span>
              </div>
            )}
          </div>

          {/* 表单 */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-xs text-gray-600">服务商</Label>
              <Select
                value={provider}
                onChange={(v) => handleProviderChange(v)}
                placeholder="请选择 LLM 服务商"
                options={providerOptions}
                allowClear={false}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs text-gray-600">
                {currentProvider?.requireCustomModel ? '模型名称' : '模型'}
              </Label>
              {currentProvider?.requireCustomModel ? (
                <Input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="请填写模型名称，如 qwen-plus"
                  autoComplete="off"
                />
              ) : (
                <Select
                  value={model}
                  onChange={(v) => setModel(v)}
                  placeholder="请选择模型"
                  options={modelOptions}
                  allowClear={false}
                />
              )}
            </div>
          </div>

          {/* 阿里云百炼需要用户填写 API 网址 */}
          {currentProvider?.requireCustomBaseUrl && (
            <div className="grid gap-1.5">
              <Label className="text-xs text-gray-600">API 网址</Label>
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={currentProvider.baseUrlHint || '请填写 API 网址'}
                autoComplete="off"
              />
              <p className="text-xs text-gray-400">
                {currentProvider.baseUrlHint}（系统会自动补全 OpenAI 兼容端点后缀）
              </p>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label className="text-xs text-gray-600">API Key</Label>
            <div className="flex items-center gap-2">
              <Input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={currentLlm?.hasApiKey ? '已配置，如需更新请重新填写' : '请填写 API Key'}
                className="flex-1"
                autoComplete="off"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowApiKey((v) => !v)}
              >
                {showApiKey ? '隐藏' : '显示'}
              </Button>
            </div>
            <p className="text-xs text-gray-400">
              {provider === 'aliyun' && '阿里云百炼：在「模型服务灵积」控制台 → API-KEY 管理 获取'}
              {provider === 'deepseek' && 'DeepSeek：登录 deepseek.com → API Keys 页面创建'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={handleSaveLlm}
              disabled={saving !== null || !provider || !apiKey.trim() || (currentProvider?.requireCustomBaseUrl ? !baseUrl.trim() : false) || (currentProvider?.requireCustomModel ? !model.trim() : false)}
              className="bg-teal-600 hover:bg-teal-700"
              size="sm"
            >
              {saving === 'llm' ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              保存 LLM 配置
            </Button>
            {currentLlm?.hasApiKey && (
              <Button
                onClick={handleDeleteLlm}
                disabled={saving !== null}
                variant="outline"
                size="sm"
              >
                <Trash2 className="size-4" />
                删除
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* VLM 视觉模型配置卡片 */}
      <VlmConfigCard mode={mode} onSaved={onSaved} />

      {/* OCR 配置卡片 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScanText className="size-4 text-violet-600" />
            PaddleOCR API Token
          </CardTitle>
          <CardDescription>
            {ocrLabel} · 用于拍照识别试剂信息
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 当前 OCR 状态 */}
          <div className="rounded-md bg-gray-50 p-3">
            <div className="mb-1.5 text-xs font-medium text-gray-500">
              当前{isLab ? '实验室统一' : '个人'} OCR Token
            </div>
            {currentOcr?.hasApiKey ? (
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="outline" className="border-violet-500 text-violet-700">{ocrLabel}</Badge>
                <span className="text-xs text-emerald-600">● 已配置</span>
              </div>
            ) : (
              <div className="text-sm text-gray-500">
                {isLab ? '尚未配置实验室统一 OCR Token' : '尚未配置个人 OCR Token'}
                {!isLab && labLevelOcr?.hasApiKey && (
                  <span className="ml-2 text-xs text-teal-600">（已使用实验室统一配置）</span>
                )}
              </div>
            )}
            {!isLab && labLevelOcr?.hasApiKey && (
              <div className="mt-2 text-xs text-gray-500">
                实验室统一配置：
                <Badge variant="outline" className="ml-1 text-gray-600">{ocrLabel}</Badge>
                <span className="ml-1 text-teal-600">可用</span>
              </div>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs text-gray-600">OCR Access Token</Label>
            <Input
              type="password"
              value={ocrToken}
              onChange={(e) => setOcrToken(e.target.value)}
              placeholder={currentOcr?.hasApiKey ? '已配置，如需更新请重新填写' : '请填写 PaddleOCR API Token'}
              autoComplete="off"
            />
            <p className="text-xs text-gray-400">
              在「百度飞桨 AIStudio」个人中心 → 访问令牌 获取 Access Token
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={handleSaveOcr}
              disabled={saving !== null || !ocrToken.trim()}
              className="bg-violet-600 hover:bg-violet-700"
              size="sm"
            >
              {saving === 'ocr' ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              保存 OCR Token
            </Button>
            {currentOcr?.hasApiKey && (
              <Button
                onClick={handleDeleteOcr}
                disabled={saving !== null}
                variant="outline"
                size="sm"
              >
                <Trash2 className="size-4" />
                删除
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
