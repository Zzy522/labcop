'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/arco-adapters/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, Save, Trash2, Eye, AlertCircle, CheckCircle2 } from 'lucide-react';
import { authFetch } from '@/lib/auth-fetch';
import { DEFAULT_VLM_PROVIDER, DEFAULT_VLM_MODEL } from '@/lib/model-defaults';

interface ProviderInfo {
  key: string;
  label: string;
  models: Array<{ value: string; label: string }>;
  requireCustomBaseUrl?: boolean;
  requireCustomModel?: boolean;
  baseUrlHint?: string;
}

interface ConfigStatus {
  provider?: string;
  model?: string | null;
  hasApiKey?: boolean;
  baseUrl?: string | null;
}

interface VlmConfigCardProps {
  mode: 'personal' | 'lab';
  onSaved?: () => void;
}

/**
 * VLM（视觉模型）配置卡片
 *
 * 独立于 LLM 配置：常规对话/查表用 LLM，仅图像理解（图片/PPT/谱图）用 VLM。
 * 保存 service='vlm' 到 /api/llm-config（personal）或 /api/llm-config/lab（lab）。
 */
export function VlmConfigCard({ mode, onSaved }: VlmConfigCardProps) {
  const isLab = mode === 'lab';
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [current, setCurrent] = useState<ConfigStatus | null>(null);
  const [labLevel, setLabLevel] = useState<ConfigStatus | null>(null);

  const [provider, setProvider] = useState(DEFAULT_VLM_PROVIDER);
  const [model, setModel] = useState(DEFAULT_VLM_MODEL);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const url = isLab ? '/api/llm-config/lab' : '/api/llm-config';
      const res = await authFetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || '加载失败');
      const payload = data.data;
      const vlmProviders = payload.availableVlmProviders || [];
      setProviders(vlmProviders);
      if (isLab) {
        setCurrent(payload.vlm || null);
        if (payload.vlm?.provider) {
          setProvider(payload.vlm.provider);
          setModel(payload.vlm.model || DEFAULT_VLM_MODEL);
          setBaseUrl(payload.vlm.baseUrl || '');
        }
      } else {
        setCurrent(payload.personal?.vlm || null);
        setLabLevel(payload.labLevel?.vlm || null);
        if (payload.personal?.vlm?.provider) {
          setProvider(payload.personal.vlm.provider);
          setModel(payload.personal.vlm.model || DEFAULT_VLM_MODEL);
          setBaseUrl(payload.personal.vlm.baseUrl || '');
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [isLab]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const currentProvider = providers.find((p) => p.key === provider);

  const handleProviderChange = useCallback((v: string) => {
    setProvider(v);
    const cfg = providers.find((p) => p.key === v);
    setModel(cfg?.requireCustomModel ? '' : cfg?.models[0]?.value || DEFAULT_VLM_MODEL);
    setBaseUrl('');
    setApiKey('');
  }, [providers]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      if (!apiKey.trim()) throw new Error('请填写 VLM API Key');
      if (currentProvider?.requireCustomBaseUrl && !baseUrl.trim()) throw new Error('请填写 API 网址');
      if (currentProvider?.requireCustomModel && !model.trim()) throw new Error('请填写模型名称');

      const url = isLab ? '/api/llm-config/lab' : '/api/llm-config';
      const body: Record<string, unknown> = { service: 'vlm', provider, apiKey: apiKey.trim(), model: model.trim() };
      if (currentProvider?.requireCustomBaseUrl) body.baseUrl = baseUrl.trim();

      const res = await authFetch(url, { method: 'PUT', body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || '保存失败');

      setSuccess(isLab ? '实验室统一 VLM 配置已保存' : '个人 VLM 配置已保存');
      setApiKey('');
      await fetchConfig();
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [apiKey, provider, model, baseUrl, currentProvider, isLab, fetchConfig, onSaved]);

  const handleDelete = useCallback(async () => {
    if (!confirm('确认删除 VLM 配置？图片理解功能将不可用。')) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const url = isLab ? '/api/llm-config/lab?service=vlm' : '/api/llm-config?service=vlm';
      const res = await authFetch(url, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || '删除失败');
      setSuccess('VLM 配置已删除');
      setProvider(DEFAULT_VLM_PROVIDER);
      setModel(DEFAULT_VLM_MODEL);
      setBaseUrl('');
      await fetchConfig();
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setSaving(false);
    }
  }, [isLab, fetchConfig, onSaved]);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="size-4 animate-spin text-gray-400" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Eye className="size-4 text-indigo-600" />
          VLM 视觉模型配置
        </CardTitle>
        <CardDescription>
          用于图片 / PPT / 谱图 / 实验照片理解。常规对话走 LLM，仅图像分析走 VLM，降低成本与延迟
        </CardDescription>
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
          提示：当前图像理解采用 <strong>OpenAI 兼容 vision API</strong>（请求体 messages 内含 image_url）。
          自定义服务商需兼容此格式——GLM-4V / Qwen-VL / GPT-4o 等主流视觉模型均兼容；
          若你的 VLM 服务不是 OpenAI 兼容格式（如部分私有部署的非标准接口），可能无法识别图片。
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 当前状态 */}
        <div className="rounded-md bg-gray-50 p-3">
          <div className="mb-1.5 text-xs font-medium text-gray-500">当前{isLab ? '实验室统一' : '个人'} VLM 配置</div>
          {current?.hasApiKey ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline" className="border-indigo-500 text-indigo-700">
                {providers.find((p) => p.key === current.provider)?.label || current.provider}
              </Badge>
              {current.model && <Badge variant="outline" className="text-gray-600">{current.model}</Badge>}
              <span className="text-xs text-emerald-600">● 已配置</span>
            </div>
          ) : (
            <div className="text-sm text-gray-500">
              尚未配置 VLM
              {!isLab && labLevel?.hasApiKey && <span className="ml-2 text-xs text-indigo-600">（将使用实验室统一 VLM 配置）</span>}
              {!isLab && !labLevel?.hasApiKey && <span className="ml-2 text-xs text-gray-400">（未配置时将回退到 LLM，需 LLM 模型支持视觉）</span>}
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{error}</span>
          </div>
        )}
        {success && (
          <div className="flex items-start gap-2 rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" /><span>{success}</span>
          </div>
        )}

        {/* 表单 */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label className="text-xs text-gray-600">服务商</Label>
            <Select
              value={provider}
              onChange={handleProviderChange}
              placeholder="选择 VLM 服务商"
              options={providers.map((p) => ({ value: p.key, label: p.label }))}
              allowClear={false}
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs text-gray-600">{currentProvider?.requireCustomModel ? '模型名称' : '模型'}</Label>
            {currentProvider?.requireCustomModel ? (
              <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="如 qwen-vl-max" autoComplete="off" />
            ) : (
              <Select
                value={model}
                onChange={(v) => setModel(v)}
                placeholder="选择模型"
                options={currentProvider?.models.map((m) => ({ value: m.value, label: m.label })) || []}
                allowClear={false}
              />
            )}
          </div>
        </div>

        {currentProvider?.requireCustomBaseUrl && (
          <div className="grid gap-1.5">
            <Label className="text-xs text-gray-600">API 网址</Label>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={currentProvider.baseUrlHint || '请填写 API 网址'} autoComplete="off" />
            <p className="text-xs text-gray-400">{currentProvider.baseUrlHint}</p>
          </div>
        )}

        <div className="grid gap-1.5">
          <Label className="text-xs text-gray-600">API Key</Label>
          <div className="flex items-center gap-2">
            <Input
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={current?.hasApiKey ? '已配置，如需更新请重新填写' : '请填写 VLM API Key'}
              className="flex-1"
              autoComplete="off"
            />
            <Button type="button" variant="outline" size="sm" onClick={() => setShowApiKey((v) => !v)}>
              {showApiKey ? '隐藏' : '显示'}
            </Button>
          </div>
          <p className="text-xs text-gray-400">
            {provider === 'zhipu' && '智谱：登录 bigmodel.cn → API Keys 获取（GLM-4V 支持图像理解）'}
            {provider === 'aliyun_vl' && '阿里云百炼：模型服务灵积控制台 → API-KEY 管理'}
            {provider === 'openai' && 'OpenAI：platform.openai.com → API Keys（gpt-4o 支持视觉）'}
            {provider === 'custom' && '自定义：填写你的 OpenAI 兼容 vision API 的访问密钥'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={handleSave}
            disabled={saving || !apiKey.trim() || (currentProvider?.requireCustomBaseUrl ? !baseUrl.trim() : false) || (currentProvider?.requireCustomModel ? !model.trim() : false)}
            className="bg-indigo-600 hover:bg-indigo-700"
            size="sm"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存 VLM 配置
          </Button>
          {current?.hasApiKey && (
            <Button onClick={handleDelete} disabled={saving} variant="outline" size="sm">
              <Trash2 className="size-4" />删除
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
