import { describe, expect, it, vi } from 'vitest';
import {
  getStandardSmiles,
  KetcherOperationTimeoutError,
  runKetcherOperation,
} from '@/lib/ketcher';

describe('runKetcherOperation', () => {
  it('returns a completed Ketcher operation result', async () => {
    await expect(runKetcherOperation(() => Promise.resolve('CCO'), 100)).resolves.toBe('CCO');
  });

  it('rejects a pending operation within the configured timeout', async () => {
    vi.useFakeTimers();
    const operation = runKetcherOperation(() => new Promise<string>(() => {}), 500);
    const assertion = expect(operation).rejects.toBeInstanceOf(KetcherOperationTimeoutError);
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
    vi.useRealTimers();
  });
});

describe('getStandardSmiles', () => {
  it('awaits Ketcher and explicitly requests standard SMILES', async () => {
    const getSmiles = vi.fn().mockResolvedValue('C1=CC=CC=C1');

    await expect(getStandardSmiles({ getSmiles }, 100)).resolves.toBe('C1=CC=CC=C1');
    expect(getSmiles).toHaveBeenCalledOnce();
    expect(getSmiles).toHaveBeenCalledWith(false);
  });
});
