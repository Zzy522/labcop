import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { MaintenanceSnapshot } from '@/lib/maintenance';

type MaintenanceFallbackState = Pick<
  MaintenanceSnapshot,
  'enabled' | 'active' | 'title' | 'message' | 'startsAt' | 'estimatedEndAt' | 'updatedAt'
> & {
  schemaVersion: 1;
};

/**
 * 将公开的维护信息同步到 Nginx 可读取的共享目录。
 *
 * 仅在显式配置 MAINTENANCE_STATIC_DIR 时写入，避免非 Docker 开发环境产生文件。
 * 临时文件与目标文件位于同一目录，生产 Linux 环境下 rename 为原子替换。
 */
export async function syncMaintenanceFallbackState(
  snapshot: MaintenanceSnapshot,
  directory = process.env.MAINTENANCE_STATIC_DIR,
): Promise<void> {
  if (!directory) return;

  const state: MaintenanceFallbackState = {
    schemaVersion: 1,
    enabled: snapshot.enabled,
    active: snapshot.active,
    title: snapshot.title,
    message: snapshot.message,
    startsAt: snapshot.startsAt,
    estimatedEndAt: snapshot.estimatedEndAt,
    updatedAt: snapshot.updatedAt,
  };
  const target = path.join(directory, 'state.json');
  const temporary = path.join(directory, `.state.${process.pid}.${Date.now()}.tmp`);

  await mkdir(directory, { recursive: true, mode: 0o755 });
  await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o644 });
  try {
    await rename(temporary, target);
  } catch (error) {
    // Windows 本地测试可能不允许 rename 覆盖已有文件；生产 Linux 不会进入此分支。
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'EPERM') {
      await rm(temporary, { force: true });
      throw error;
    }
    await rm(target, { force: true });
    await rename(temporary, target);
  }
}
