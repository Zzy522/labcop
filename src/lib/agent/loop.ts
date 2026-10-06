/**
 * Agent 循环（Function Calling）
 *
 * 受控的 ReAct 式循环，防死循环设计：
 * - maxRounds：最多循环轮次（默认 5），超限强制收尾
 * - maxToolCalls：最多工具调用总数（默认 10），防止 LLM 反复调工具
 * - 超时：每次 LLM 调用 60s 超时
 * - truncated：达到上限时强制最后一轮无 tools 生成总结，绝不无限循环
 *
 * 流程：
 *   阶段1（工具调用循环，非流式）：LLM 带 tools → 若返回 tool_calls 则执行（只读查表）→
 *     把结果作为 tool 消息回填 → 继续；直到无 tool_calls 或达到上限
 *   阶段2（流式生成）：用累积的上下文（含工具结果）流式生成最终回答
 */
import { AGENT_TOOLS, executeTool, type ToolContext } from './tools';
import { fetchUpstream } from '@/lib/upstream-fetch';
import { withRetry, LLM_RETRY } from '@/lib/retry';
import { redactInternalIdentifiers } from './output-safety';
import type { TraceRecorder } from './trace';

export interface AgentLoopOptions {
  trace?: TraceRecorder;
  signal?: AbortSignal;
  baseUrl: string;
  apiKey: string;
  model: string;
  systemMessages: Array<{ role: 'system'; content: string }>;
  conversationMessages: Array<{ role: string; content: string }>;
  ctx: ToolContext;
  maxRounds?: number;
  maxToolCalls?: number;
  /** false 时跳过工具规划，直接进行一次流式回答，显著降低普通对话首 Token 延迟。 */
  enableTools?: boolean;
  onDelta?: (delta: string) => void;
}

export interface AgentLoopResult {
  finalContent: string;
  rounds: number;
  toolCallCount: number;
  truncated: boolean;
}

interface ToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

interface LlmMessage {
  role: string;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

const DEFAULT_MAX_ROUNDS = 5;
const DEFAULT_MAX_TOOL_CALLS = 10;
const LLM_TIMEOUT_MS = 60_000;

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const maxToolCalls = options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  let rounds = 0;
  let toolCallCount = 0;
  let truncated = false;

  const workingMessages: LlmMessage[] = [
    ...options.systemMessages.map((m) => ({ role: 'system', content: m.content })),
    ...options.conversationMessages.map((m) => ({ role: m.role, content: m.content })),
  ];

  // ─── 阶段1：按需工具调用循环（非流式） ───
  // 普通对话不进入该循环，避免“先完整规划一次、再流式回答一次”的双模型延迟。
  while (options.enableTools !== false && rounds < maxRounds && toolCallCount < maxToolCalls) {
    rounds++;
    const msg = options.trace
      ? await options.trace.span('model', `planning.${rounds}`, { model: options.model, messageCount: workingMessages.length }, () => callLlmNonStream(options, workingMessages), result => ({ tool_calls: result.tool_calls || [] }))
      : await callLlmNonStream(options, workingMessages);
    const toolCalls = msg.tool_calls || [];

    // 无工具调用 → LLM 准备直接回答，进入流式生成阶段
    if (toolCalls.length === 0) break;

    // 有工具调用：回填 assistant 消息（含 tool_calls）
    workingMessages.push({ role: 'assistant', content: msg.content || null, tool_calls: toolCalls });

    // 逐个执行工具（只读），回填 tool 消息
    for (const tc of toolCalls) {
      if (toolCallCount >= maxToolCalls) break;
      toolCallCount++;
      options.signal?.throwIfAborted();
      const result = options.trace
        ? await options.trace.span('tool', tc.function.name, { callId: tc.id, arguments: tc.function.arguments, round: rounds }, () => executeTool(tc.function.name, tc.function.arguments, options.ctx))
        : await executeTool(tc.function.name, tc.function.arguments, options.ctx);
      workingMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        name: tc.function.name,
        content: result,
      });
    }
  }

  if (options.enableTools !== false && (rounds >= maxRounds || toolCallCount >= maxToolCalls)) {
    truncated = true;
  }

  // ─── 阶段2：流式生成最终回答（不带 tools，强制直接回答） ───
  const finalContent = options.trace
    ? await options.trace.span('model', 'answer.stream', { model: options.model, messageCount: workingMessages.length }, () => callLlmStream(options, workingMessages, options.onDelta), result => ({ characters: result.length }))
    : await callLlmStream(options, workingMessages, options.onDelta);

  return { finalContent, rounds, toolCallCount, truncated };
}

async function requestModel(options: AgentLoopOptions, init: RequestInit): Promise<Response> {
  let attempt = 0;
  return withRetry(() => {
    const current = ++attempt;
    const call = () => fetchUpstream(`${options.baseUrl}/chat/completions`, init);
    return options.trace ? options.trace.span('http', `model.request.${current}`, { model: options.model, attempt: current }, call, r => ({ httpStatus: r.status })) : call();
  }, LLM_RETRY);
}
async function recordUsage(options: AgentLoopOptions, usage: unknown) {
  if (usage && typeof usage === 'object' && options.trace) {
    const fields = usage as Record<string,unknown>;
    const safe = Object.fromEntries(['prompt_tokens','completion_tokens','total_tokens'].filter(k => typeof fields[k] === 'number').map(k=>[k,fields[k]]));
    await options.trace.span('usage', 'provider.usage', {}, async()=>safe);
  }
}

/** 非流式调用 LLM（带 tools），返回完整 message（用于判断 tool_calls） */
async function callLlmNonStream(options: AgentLoopOptions, messages: LlmMessage[]): Promise<LlmMessage> {
  const resp = await requestModel(options, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      messages,
      tools: AGENT_TOOLS,
      tool_choice: 'auto',
      temperature: 0.3,
      max_tokens: 1200,
    }),
    cache: 'no-store',
    signal: AbortSignal.any([AbortSignal.timeout(LLM_TIMEOUT_MS), ...(options.signal ? [options.signal] : [])]),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`LLM 调用失败（${resp.status}）：${errText.slice(0, 200)}`);
  }
  const data = await resp.json();
  await recordUsage(options, data?.usage);
  return data?.choices?.[0]?.message as LlmMessage;
}

/** 流式调用 LLM（不带 tools），onDelta 回调增量，返回完整文本 */
async function callLlmStream(
  options: AgentLoopOptions,
  messages: LlmMessage[],
  onDelta?: (delta: string) => void
): Promise<string> {
  const resp = await requestModel(options, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      messages,
      temperature: 0.7,
      max_tokens: 2000,
      stream: true,
    }),
    cache: 'no-store',
    signal: AbortSignal.any([AbortSignal.timeout(LLM_TIMEOUT_MS), ...(options.signal ? [options.signal] : [])]),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`LLM 流式调用失败（${resp.status}）：${errText.slice(0, 200)}`);
  }

  const reader = resp.body?.getReader();
  if (!reader) throw new Error('LLM 响应流读取失败');

  let fullContent = '';
  let pendingContent = '';
  const decoder = new TextDecoder();
  const emitSafeContent = (flush = false) => {
    pendingContent = redactInternalIdentifiers(pendingContent);
    const retainedLength = flush ? 0 : Math.min(64, pendingContent.length);
    const emitLength = pendingContent.length - retainedLength;
    if (emitLength <= 0) return;
    const visibleDelta = pendingContent.slice(0, emitLength);
    pendingContent = pendingContent.slice(emitLength);
    fullContent += visibleDelta;
    onDelta?.(visibleDelta);
  };
  try {
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(dataStr);
          await recordUsage(options, parsed?.usage);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (delta) {
            pendingContent += delta;
            emitSafeContent();
          }
        } catch {
          // 单行解析失败不影响整体
        }
      }
    }
    emitSafeContent(true);
  } finally {
    reader.releaseLock();
  }
  return fullContent;
}
