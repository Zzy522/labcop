import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({ after: [] as Array<() => Promise<void>>, upstream: vi.fn(), user: { userId: 'trace-user', labId: 'trace-lab', isAdmin: false, isPlatformAdmin: false } }));
vi.mock('next/server', async importOriginal => ({ ...await importOriginal<typeof import('next/server')>(), after: (callback: () => Promise<void>) => mocks.after.push(callback) }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth-middleware', () => ({ requireAuth: async () => mocks.user, requirePlatformAdmin: async () => mocks.user.isPlatformAdmin ? mocks.user : NextResponse.json({error:'forbidden'},{status:403}), isUserContext: (value: unknown) => !(value instanceof NextResponse) }));
vi.mock('@/lib/api-config', () => ({ getEffectiveLlmConfig: async () => ({ baseUrl: 'https://fixture.invalid', apiKey: 'fixture-secret', model: 'fixture-model' }), getEffectiveVlmConfig: async () => null }));
vi.mock('@/lib/upstream-fetch', () => ({ fetchUpstream: mocks.upstream }));
vi.mock('@/lib/retry', () => ({ withRetry: (fn: () => unknown) => fn(), LLM_RETRY: {} }));
vi.mock('@/lib/memory/user-profile', () => ({ loadUserProfileContext: async () => '' }));
vi.mock('@/lib/memory/entity-extractor', () => ({ extractEntities: async () => [] }));
vi.mock('@/lib/memory/service', () => ({ searchRelevantEntities: async () => [], buildEntityContext: () => '', upsertEntities: async () => {} }));
vi.mock('@/lib/error-report', () => ({ reportError: () => {} }));
vi.mock('@/lib/prisma', async () => {
  const { PrismaClient } = await import('@/generated/prisma/client');
  const { PrismaLibSql } = await import('@prisma/adapter-libsql');
  const directory = await mkdtemp(path.join(tmpdir(), 'assistant-run-'));
  const url = `file:${path.join(directory, 'test.db').replace(/\\/g, '/')}`;
  return { prisma: new PrismaClient({ adapter: new PrismaLibSql({ url }) }), testDirectory: directory, testUrl: url };
});
import { prisma } from '@/lib/prisma';
import { POST as chat } from '@/app/api/assistant/chat/route';
import { POST as cancel } from '@/app/api/assistant/generations/[id]/cancel/route';
import { GET as readConversation } from '@/app/api/assistant/sessions/[id]/route';
import { POST as feedback } from '@/app/api/assistant/feedback/route';
import { GET as listRuns } from '@/app/api/platform/assistant-runs/route';
import { GET as getSession } from '@/app/api/platform/assistant-sessions/[id]/route';
import { cleanupDiagnostics } from '@/lib/scheduler/tasks/diagnostic-cleanup';
import { GET as getTrace } from '@/app/api/assistant/runs/[id]/route';
let directory: string;
beforeAll(async () => {
  const fixture = await import('@/lib/prisma') as unknown as { testDirectory: string; testUrl: string };
  directory = fixture.testDirectory;
  const client = createClient({ url: fixture.testUrl });
  for (const folder of (await readdir('prisma/migrations')).sort()) if (/^\d/.test(folder)) await client.executeMultiple(await readFile(`prisma/migrations/${folder}/migration.sql`, 'utf8'));
  client.close();
  await prisma.lab.create({ data: { id: 'trace-lab', name: 'Test', location: 'Test' } });
  await prisma.user.create({ data: { id: 'trace-user', name: 'Test', email: 'trace@test.invalid', password: 'unused', labId: 'trace-lab' } });
  await prisma.assistantDiagnosticPolicy.create({data:{labId:'trace-lab',enabled:true,expiresAt:new Date(Date.now()+86400000),retentionDays:30,updatedBy:'trace-user'}});
  await prisma.assistantDiagnosticGrant.create({data:{userId:'trace-user',canReadContent:true,canExport:true,labIds:'[]'}});
  await prisma.reagent.create({ data: { labId: 'trace-lab', name: '乙醇', stockQuantity: 5, unit: '瓶' } });
}, 30000);
afterAll(async () => { await prisma.$disconnect(); if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(error => { if (process.platform !== 'win32' || error.code !== 'EBUSY') throw error; }); });
const request = (url: string, body: unknown) => new NextRequest(`http://localhost${url}`, { method: 'POST', body: JSON.stringify(body) });

describe('real SQLite answer → tools → feedback → trace', () => {
  it('retains exact input selection and tool outputs and enforces real relational sharing', async () => {
    mocks.upstream.mockResolvedValueOnce(Response.json({ choices: [{ message: { role: 'assistant', content: null, reasoning_content: 'hidden-thought', tool_calls: [{ id: 'call1', type: 'function', function: { name: 'query_reagent', arguments: '{"keyword":"乙醇"}' } }] } }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { role: 'assistant', content: 'ready' } }] }))
      .mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"乙醇库存为 5 瓶。"}}]}\n\ndata: [DONE]\n\n'));
    const response = await chat(request('/api/assistant/chat', { messages: [{ role: 'user', content: '请查询试剂乙醇库存' }], assistantMode: 'RESEARCH' }));
    expect(response.status).toBe(200);
    const events = (await response.text()).split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)));
    const created = events.find(item => item.stage === 'session_created');
    expect(events.some(item => item.stage === 'done')).toBe(true);
    const run = await prisma.assistantRun.findUniqueOrThrow({ where: { id: created.runId }, include: { spans: true, message: true } });
    expect(run.messageId).toBe(created.messageId); expect(run.status).toBe('OK'); expect(run.message.content).toBe('乙醇库存为 5 瓶。');
    expect(JSON.parse(run.input).conversation.map((item: { role: string }) => item.role)).toEqual(['user']);
    expect(run.spans.find(span => span.kind === 'tool')?.output).toContain('乙醇');
    expect(JSON.stringify(run)).not.toContain('fixture-secret'); expect(JSON.stringify(run)).not.toContain('hidden-thought');
    mocks.user.userId = 'other-user';
    expect((await getTrace(new NextRequest('http://localhost/api/assistant/runs/r'), { params: Promise.resolve({ id: run.id }) })).status).toBe(403);
    expect((await feedback(request('/api/assistant/feedback', { runId: run.id, category: 'OTHER', note: '', shareDiagnostics: true }))).status).toBe(404);
    mocks.user.userId = 'trace-user';
    for (let i = 0; i < 2; i++) expect((await feedback(request('/api/assistant/feedback', { runId: run.id, category: 'WRONG_ANSWER', note: '需要核对', shareDiagnostics: true }))).status).toBe(200);
    expect(await prisma.assistantCase.count({ where: { runId: run.id } })).toBe(1);
    mocks.user.isPlatformAdmin=true;
    expect((await getTrace(new NextRequest('http://localhost/api/assistant/runs/r'), { params: Promise.resolve({ id: run.id }) })).status).toBe(200);
    await prisma.chatSession.update({ where: { id: created.sessionId }, data: { deletedAt: new Date() } });
    expect((await getTrace(new NextRequest('http://localhost/api/assistant/runs/r'), { params: Promise.resolve({ id: run.id }) })).status).toBe(404);
  });
  it('persists a failed model call and links the interrupted answer', async () => {
    mocks.user.isPlatformAdmin=false;
    mocks.upstream.mockRejectedValueOnce(new Error('provider fixture-secret unavailable'));
    const response = await chat(request('/api/assistant/chat', { messages: [{ role: 'user', content: '你好' }], assistantMode: 'RESEARCH' }));
    const events = (await response.text()).split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)));
    const runId = events.find(item => item.stage === 'session_created').runId;
    const run = await prisma.assistantRun.findUniqueOrThrow({ where: { id: runId }, include: { spans: true } });
    expect(run.status).toBe('ERROR'); expect(run.error).not.toContain('fixture-secret'); expect(run.spans.some(span => span.status === 'ERROR')).toBe(true);
  });
});

describe('platform diagnostic permissions and lifecycle',()=>{
 it('accepts feedback without content sharing, hides trace from its owner, and indexes the problem number',async()=>{
  mocks.user.isPlatformAdmin=false;mocks.user.userId='trace-user';
  const run=await prisma.assistantRun.findFirstOrThrow({where:{message:{session:{deletedAt:null}}}});
  expect((await feedback(request('/api/assistant/feedback',{runId:run.id,rating:'not_useful',shareDiagnostics:false}))).status).toBe(200);
  expect((await getTrace(new NextRequest('http://localhost/api/assistant/runs/r'),{params:Promise.resolve({id:run.id})})).status).toBe(403);
  mocks.user.isPlatformAdmin=true;
  const result=await listRuns(new NextRequest(`http://localhost/api/platform/assistant-runs?q=LC-${run.id}`));expect((await result.json()).runs[0].id).toBe(run.id);
  await feedback(request('/api/assistant/feedback',{runId:run.id,rating:'useful'}));
  expect((await prisma.chatMessage.findUniqueOrThrow({where:{id:run.messageId}})).feedback).toBe('useful');
 });
 it('enforces scoped grants, export permissions and metadata-only content masking',async()=>{
  const run=await prisma.assistantRun.findFirstOrThrow({where:{message:{session:{deletedAt:null}}},include:{message:true}});
  const req=(download=false)=>getTrace(new NextRequest(`http://localhost/api/assistant/runs/r${download?'?download=1':''}`),{params:Promise.resolve({id:run.id})});
  await prisma.assistantDiagnosticGrant.update({where:{userId:'trace-user'},data:{labIds:'["different-lab"]'}});expect((await req()).status).toBe(404);
  await prisma.assistantDiagnosticGrant.update({where:{userId:'trace-user'},data:{labIds:'[]',canReadContent:false,canExport:false}});
  const masked=await (await req()).json();expect(masked.input).toBe('{}');expect(masked.contentAvailable).toBe(false);expect((await req(true)).status).toBe(403);
  await prisma.assistantDiagnosticGrant.update({where:{userId:'trace-user'},data:{canReadContent:true,canExport:true}});
  const transcript=await getSession(new NextRequest('http://localhost/api/platform/assistant-sessions/s'),{params:Promise.resolve({id:run.message.sessionId})});expect(transcript.status).toBe(200);
  await prisma.assistantRun.update({where:{id:run.id},data:{expiresAt:new Date(0)}});
  expect((await (await req()).json()).contentAvailable).toBe(false);
  await cleanupDiagnostics();const purged=await prisma.assistantRun.findUniqueOrThrow({where:{id:run.id}});expect(purged.purgedAt).not.toBeNull();expect(purged.input).toBe('{}');expect(purged.output).toBe('');
 });
 it('records no private snapshots for new runs when test capture is disabled',async()=>{
  await prisma.assistantDiagnosticPolicy.update({where:{labId:'trace-lab'},data:{enabled:false}});mocks.user.isPlatformAdmin=false;
  mocks.upstream.mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"private-answer"}}]}\n\ndata: [DONE]\n\n'));
  const response=await chat(request('/api/assistant/chat',{messages:[{role:'user',content:'hello-private-question'}],assistantMode:'RESEARCH'}));
  const events=(await response.text()).split('\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5)));const id=events.find(e=>e.stage==='session_created').runId;
  const run=await prisma.assistantRun.findUniqueOrThrow({where:{id},include:{spans:true}});expect(run.captureContent).toBe(false);expect(run.input).not.toContain('hello-private-question');expect(run.output).toBe('');expect(JSON.stringify(run.spans)).not.toContain('private-answer');
 });
});


describe('background generation lifecycle', () => {
  it('accepts before generating and completes after the browser disconnects', async () => {
    mocks.user.userId = 'trace-user'; mocks.user.isPlatformAdmin = false;
    const disconnected = new AbortController();
    const response = await chat(new NextRequest('http://localhost/api/assistant/chat', { method: 'POST', signal: disconnected.signal, body: JSON.stringify({ background: true, messages: [{ role: 'user', content: '你好' }], assistantMode: 'RESEARCH' }) }));
    expect(response.status).toBe(202);
    const accepted = await response.json();
    expect((await prisma.assistantRun.findUniqueOrThrow({where:{id:accepted.runId}})).status).toBe('RUNNING');
    const duplicate = await chat(request('/api/assistant/chat', { background:true, sessionId:accepted.sessionId, assistantMode:'RESEARCH', messages:[{role:'user',content:'你好'}] }));
    expect(duplicate.status).toBe(409);
    disconnected.abort();
    mocks.upstream.mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"后台完成"}}]}\n\ndata: [DONE]\n\n'));
    await mocks.after.shift()!();
    const result = await readConversation(new NextRequest('http://localhost/api/assistant/sessions/s'),{params:Promise.resolve({id:accepted.sessionId})});
    const last = (await result.json()).messages.at(-1);
    expect(last.content).toBe('后台完成'); expect(last.run.status).toBe('OK');
    expect(await prisma.chatMessage.count({where:{sessionId:accepted.sessionId}})).toBe(2);
    mocks.user.userId='other-user';
    expect((await readConversation(new NextRequest('http://localhost/api/assistant/sessions/s'),{params:Promise.resolve({id:accepted.sessionId})})).status).toBe(404);
    mocks.user.userId='trace-user';
  });
  it('requires ownership to cancel and preserves cancellation as a terminal state', async () => {
    const response = await chat(request('/api/assistant/chat', { background:true, assistantMode:'RESEARCH',messages:[{role:'user',content:'你好'}] }));
    const accepted=await response.json();
    const stop=()=>cancel(request('/api/assistant/generations/x/cancel',{}),{params:Promise.resolve({id:accepted.runId})});
    mocks.user.userId='other-user'; expect((await stop()).status).toBe(404);
    mocks.user.userId='trace-user'; expect((await stop()).status).toBe(200);
    const calls = mocks.upstream.mock.calls.length;
    await mocks.after.shift()!();
    const run=await prisma.assistantRun.findUniqueOrThrow({where:{id:accepted.runId},include:{message:true}});
    expect(run.status).toBe('CANCELLED'); expect(run.message.content).toContain('已停止');
    expect(mocks.upstream.mock.calls.length).toBe(calls);
  });
});


it('marks abandoned generation after a restart without replaying it', async () => {
  const run=await prisma.assistantRun.findFirstOrThrow({where:{status:'CANCELLED'},include:{message:true}});
  await prisma.assistantRun.update({where:{id:run.id},data:{status:'RUNNING',createdAt:new Date(Date.now()-660000)}});
  const calls=mocks.upstream.mock.calls.length;
  const response=await readConversation(new NextRequest('http://localhost/api/assistant/sessions/s'),{params:Promise.resolve({id:run.message.sessionId})});
  expect((await response.json()).messages.at(-1).run.status).toBe('ERROR');
  expect(mocks.upstream.mock.calls.length).toBe(calls);
});

it('actively cancels an in-flight upstream call through the owner endpoint', async () => {
  let entered!: () => void;
  const ready=new Promise<void>(resolve=>{entered=resolve;});
  mocks.upstream.mockImplementationOnce((_url: string, options: {signal:AbortSignal}) => new Promise((_resolve,reject)=>{
    entered(); options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});
  }));
  const response=await chat(request('/api/assistant/chat',{background:true,assistantMode:'RESEARCH',messages:[{role:'user',content:'你好'}]}));
  const accepted=await response.json(); expect(response.status).toBe(202);
  const task=mocks.after.shift()!(); await ready;
  await cancel(request('/api/assistant/generations/x/cancel',{}),{params:Promise.resolve({id:accepted.runId})});
  await task;
  expect((await prisma.assistantRun.findUniqueOrThrow({where:{id:accepted.runId}})).status).toBe('CANCELLED');
},10000);
