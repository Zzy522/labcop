import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), run: vi.fn(), spanCreate: vi.fn(), spanUpdate: vi.fn(), feedback: vi.fn(), caseUpsert: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/auth-middleware', () => ({ requireAuth: mocks.auth, isUserContext: (value: unknown) => !(value instanceof NextResponse) }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  assistantRun: { findFirst: mocks.run }, assistantSpan: { create: mocks.spanCreate, update: mocks.spanUpdate }, platformAuditLog: { create: mocks.audit },
  $transaction: (callback: (tx: unknown) => Promise<unknown>) => callback({ chatMessage: { update: mocks.feedback }, assistantCase: { upsert: mocks.caseUpsert } }),
} }));
import { createTrace, traceJson } from '@/lib/agent/trace';
import { assertionSchema, candidateSchema, evaluateRegression } from '@/lib/agent/regression';

beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ userId: 'u1', labId: 'l1', isPlatformAdmin: false }); mocks.spanCreate.mockResolvedValue({ id: 's1' }); mocks.spanUpdate.mockResolvedValue({}); });
describe('trace data boundaries and failure state', () => {
  it('does not fail or repeat the tool when diagnostic storage fails', async()=>{
    mocks.spanCreate.mockRejectedValue(new Error('disk busy')); const work=vi.fn(async()=>42);
    expect(await createTrace('r').span('tool','lookup',{},work)).toBe(42);expect(work).toHaveBeenCalledOnce();
  });
  it('omits body data in metadata mode but preserves numeric usage',async()=>{
    await createTrace('r',[],false).span('tool','lookup',{query:'private'},async()=>({content:'private',total_tokens:12}));
    expect(mocks.spanCreate.mock.calls[0][0].data.input).toBe('{}');expect(mocks.spanUpdate.mock.calls[0][0].data.output).toBe('{"total_tokens":12}');
  });
  it('redacts nested secrets, encoded JSON credentials, image data and hidden reasoning', () => {
    const result = traceJson({ apiKey: 'private', child: { reasoning_content: 'hidden', output: 'Bearer abc and known-secret' }, args: '{"password":"pw"}', picture: 'data:image/png;base64,AA==' }, ['known-secret']);
    for (const secret of ['private', 'hidden', 'known-secret', 'AA==', '"pw"']) expect(result).not.toContain(secret);
    expect(result).toContain('REDACTED');
  });
  it('marks truncated data instead of pretending a complete snapshot', () => { const result = JSON.parse(traceJson('x'.repeat(25000))); expect(result.truncated).toBe(true); expect(result.characters).toBe(25000); expect(result.sha256).toHaveLength(64); });
  it('records structured tool errors even when tools return normally', async () => {
    const trace = createTrace('r'); await trace.span('tool', 'lookup', { keyword: 'ethanol' }, async () => '{"error":"not found"}');
    expect(mocks.spanUpdate.mock.calls[0][0].data.status).toBe('ERROR');
  });
  it('persists a failed span and rethrows the original error', async () => {
    const trace = createTrace('r', ['private']); const failure = new Error('request private failed');
    await expect(trace.span('model', 'answer', {}, async () => { throw failure; })).rejects.toBe(failure);
    expect(mocks.spanUpdate.mock.calls[0][0].data.error).not.toContain('private'); expect(mocks.spanUpdate.mock.calls[0][0].data.durationMs).toBeGreaterThanOrEqual(0);
  });
});
describe('regression verdicts', () => {
  const candidate = candidateSchema.parse({ release: 'new-sha', output: '乙醇库存 5 瓶', tools: ['query_reagent'], durationMs: 1200, status: 'OK' });
  it('does not call an unconfigured case a pass', () => { expect(evaluateRegression(assertionSchema.parse({}), candidate).verdict).toBe('NEEDS_REVIEW'); });
  it('fails missing tools, forbidden output, latency and interrupted runs', () => {
    for (const assertions of [{ requiredTools: ['query_compound'] }, { excludes: ['乙醇'] }, { maxDurationMs: 1000 }, { forbiddenTools: ['query_reagent'] }]) expect(evaluateRegression(assertionSchema.parse(assertions), candidate).verdict).toBe('FAIL');
    expect(evaluateRegression(assertionSchema.parse({ contains: ['乙醇'] }), { ...candidate, status: 'CANCELLED' }).verdict).toBe('FAIL');
  });
  it('passes explicit checks while preserving the need for semantic review', () => { expect(evaluateRegression(assertionSchema.parse({ contains: ['库存'], requiredTools: ['query_reagent'] }), candidate)).toMatchObject({ verdict: 'PASS', semanticReviewRequired: true }); });
});
