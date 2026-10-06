import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MaintenanceSnapshot } from '@/lib/maintenance';
import { syncMaintenanceFallbackState } from '@/lib/maintenance-static';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('Nginx 静态维护状态', () => {
  it('只写入维护页需要的公开字段，并能原子更新', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lab-cop-maintenance-'));
    directories.push(directory);
    const snapshot: MaintenanceSnapshot = {
      enabled: true,
      active: true,
      title: 'Lab Copilot 升级中',
      message: '<script>alert(1)</script>',
      startsAt: '2026-08-14T08:00:00.000Z',
      estimatedEndAt: '2026-08-14T09:00:00.000Z',
      lastNotifiedAt: '2026-08-14T07:30:00.000Z',
      updatedAt: '2026-08-14T07:30:00.000Z',
    };

    await syncMaintenanceFallbackState(snapshot, directory);
    const state = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'));

    expect(state).toEqual({
      schemaVersion: 1,
      enabled: true,
      active: true,
      title: snapshot.title,
      message: snapshot.message,
      startsAt: snapshot.startsAt,
      estimatedEndAt: snapshot.estimatedEndAt,
      updatedAt: snapshot.updatedAt,
    });
    expect(state).not.toHaveProperty('lastNotifiedAt');
  });
});
