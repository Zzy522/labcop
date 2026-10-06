import { readFile } from 'node:fs/promises';
import { createClient } from '@libsql/client';
import { expect, it } from 'vitest';

it('adds diagnostics without changing messages and cascades deletion through cases and evaluations', async () => {
  const client = createClient({ url: 'file::memory:' });
  try {
    await client.executeMultiple('PRAGMA foreign_keys=ON; CREATE TABLE ChatMessage(id TEXT PRIMARY KEY, content TEXT); INSERT INTO ChatMessage VALUES (\'m1\',\'original\');');
    await client.executeMultiple(await readFile('prisma/migrations/20260925120000_assistant_diagnostics/migration.sql', 'utf8'));
    await client.executeMultiple(`
      INSERT INTO AssistantRun(id,messageId,userId,labId,release,harness,model,mode) VALUES('r','m1','u','l','v','h','model','RESEARCH');
      INSERT INTO AssistantSpan(id,runId,sequence,kind,name,input) VALUES('s','r',1,'tool','lookup','{}');
      INSERT INTO AssistantCase(id,runId,category,note,updatedAt) VALUES('c','r','OTHER','feedback',CURRENT_TIMESTAMP);
      INSERT INTO AssistantEvaluation(id,caseId,operatorId,candidate,result) VALUES('e','c','admin','{}','{}');
    `);
    await client.executeMultiple("CREATE TABLE User(id TEXT PRIMARY KEY, platformRole TEXT, status TEXT); INSERT INTO User VALUES('dev','PLATFORM_ADMIN','ACTIVE');");
    await client.executeMultiple(await readFile('prisma/migrations/20260925150000_platform_diagnostics/migration.sql','utf8'));
    expect((await client.execute('SELECT COUNT(*) AS n FROM AssistantDiagnosticPolicy')).rows[0].n).toBe(0);
    expect((await client.execute('SELECT COUNT(*) AS n FROM AssistantDiagnosticGrant')).rows[0].n).toBe(1);
    expect((await client.execute("SELECT shared,captureContent FROM AssistantRun WHERE id='r'")).rows[0]).toMatchObject({shared:1,captureContent:1});
    expect((await client.execute('SELECT content FROM ChatMessage')).rows[0].content).toBe('original');
    await expect(client.execute("INSERT INTO AssistantCase(id,runId,category,note,updatedAt) VALUES('c2','r','OTHER','',CURRENT_TIMESTAMP)")).rejects.toThrow();
    await client.execute("DELETE FROM ChatMessage WHERE id='m1'");
    for (const table of ['AssistantRun','AssistantSpan','AssistantCase','AssistantEvaluation']) expect((await client.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n).toBe(0);
  } finally { client.close(); }
});
