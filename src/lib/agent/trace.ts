import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';

export const HARNESS_VERSION = '2026-09-25.3';
const CAP = 24000;
// Raw credentials, image bodies and provider reasoning are never diagnostic data.
const PRIVATE_KEY = /^(authorization|cookie|password|api[_-]?key|secret|token|access_token|refresh_token|dataUrl|reasoning|reasoning_content)$/i;
export function safeTrace(value: unknown, secrets: string[] = []): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    let text = value;
    if (text.trimStart().startsWith('{') || text.trimStart().startsWith('[')) {
      try { text = JSON.stringify(safeTrace(JSON.parse(text), secrets)); } catch { /* plain text */ }
    }
    for (const secret of secrets) if (secret) text = text.split(secret).join('[REDACTED]');
    text = text.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
      .replace(/\bsk-[\w-]{8,}/g, '[REDACTED]')
      .replace(/((?:api[_-]?key|password|secret|access_token)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
      .replace(/data:image\/[^;]+;base64,[\w+/=]+/g, '[IMAGE OMITTED]');
    return text.length > CAP ? { text: text.slice(0, CAP), characters: text.length, truncated: true, sha256: hash(text) } : text;
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, 80).map(item => safeTrace(item, secrets));
    return value.length > 80 ? { items, totalItems: value.length, truncated: true } : items;
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [key, PRIVATE_KEY.test(key) ? '[REDACTED]' : safeTrace(item, secrets)]));
  return value;
}
export function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
export function traceJson(value: unknown, secrets: string[] = []) {
  const result = JSON.stringify(safeTrace(value, secrets));
  return result.length > 256000 ? JSON.stringify({ text: result.slice(0, 256000), characters: result.length, truncated: true, sha256: hash(result) }) : result;
}

export interface TraceRecorder {
  span<T>(kind: string, name: string, input: unknown, work: () => Promise<T>, summarize?: (result: T) => unknown): Promise<T>;
}

export function createTrace(runId: string, secrets: string[] = [], captureContent = true): TraceRecorder {
  const parents = new AsyncLocalStorage<string>();
  let sequence = 0;
  let bytes = 0;
  function snapshot(value: unknown) {
    if (!captureContent) {
      const allowed = new Set(['model','messageCount','characters','status','httpStatus','attempt','prompt_tokens','completion_tokens','total_tokens']);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return '{}';
      return traceJson(Object.fromEntries(Object.entries(value).filter(([key,item]) => allowed.has(key) && (typeof item === 'number' || typeof item === 'string'))), secrets);
    }
    const result = traceJson(value, secrets);
    bytes += Buffer.byteLength(result);
    return bytes <= 512000 ? result : '{"omitted":"run content budget exceeded"}';
  }
  return {
    async span(kind, name, input, work, summarize) {
      const start = Date.now();
      const current = ++sequence;
      const span = current <= 80 ? await prisma.assistantSpan.create({ data: { runId, parentId: parents.getStore(), sequence: current, kind, name, input: snapshot(input) } }).catch(() => null) : null;
      try {
        const result = span ? await parents.run(span.id, work) : await work();
        let toolError: unknown;
        if (kind === 'http' && result instanceof Response && !result.ok) toolError = `HTTP_${result.status}`;
        if (kind === 'tool' && typeof result === 'string') { try { toolError = JSON.parse(result)?.error; } catch { /* plain text */ } }
        if (span) {
          try {
            await prisma.assistantSpan.update({ where: { id: span.id }, data: { status: toolError ? 'ERROR' : 'OK', output: snapshot(summarize ? summarize(result) : result), error: toolError ? (captureContent ? snapshot(toolError) : 'TOOL_ERROR') : null, durationMs: Date.now() - start } });
          } catch { console.error('[trace] span persistence failed', span.id); }
        }
        return result;
      } catch (error) {
        if (span) await prisma.assistantSpan.update({ where: { id: span.id }, data: { status: 'ERROR', error: captureContent ? snapshot(error instanceof Error ? error.message : 'Unknown error') : 'STAGE_ERROR', durationMs: Date.now() - start } }).catch(() => undefined);
        throw error;
      }
    },
  };
}
