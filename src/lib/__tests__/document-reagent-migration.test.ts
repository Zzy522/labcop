import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { describe, expect, it } from 'vitest';

describe('DocumentReagent migration', () => {
  it('backfills multiple confirmed reagents to one stored document', async () => {
    const client = createClient({ url: 'file::memory:' });
    try {
      await client.executeMultiple(`
        CREATE TABLE Document (id TEXT PRIMARY KEY, recognitionResult JSON);
        CREATE TABLE Reagent (id TEXT PRIMARY KEY);
      `);
      await client.execute({ sql: 'INSERT INTO Reagent(id) VALUES (?), (?)', args: ['r1', 'r2'] });
      await client.execute({
        sql: 'INSERT INTO Document(id, recognitionResult) VALUES (?, ?)',
        args: ['d1', JSON.stringify({
          items: [
            { confirmationStatus: 'CONFIRMED', reagentId: 'r1' },
            { confirmationStatus: 'CONFIRMED', reagentId: 'r2' },
          ],
        })],
      });
      const migration = await readFile(
        join(process.cwd(), 'prisma/migrations/20260810010000_add_document_reagent_links/migration.sql'),
        'utf8'
      );
      await client.executeMultiple(migration);
      const result = await client.execute('SELECT documentId, reagentId, itemIndex FROM DocumentReagent ORDER BY itemIndex');
      expect(result.rows).toEqual([
        { documentId: 'd1', reagentId: 'r1', itemIndex: 0 },
        { documentId: 'd1', reagentId: 'r2', itemIndex: 1 },
      ]);
    } finally {
      await client.close();
    }
  });
});
