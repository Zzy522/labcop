"use client";

export const KETCHER_OPERATION_TIMEOUT_MS = 8_000;

export interface KetcherStructureExporter {
  getSmiles(isExtended?: boolean): Promise<string>;
}

export interface KetcherApi extends KetcherStructureExporter {
  setMolecule(structure: string): Promise<void>;
  clear(): Promise<void>;
}

export class KetcherOperationTimeoutError extends Error {
  constructor() {
    super("分子绘图引擎响应超时，请稍后重试");
    this.name = "KetcherOperationTimeoutError";
  }
}

/**
 * Ketcher 2.x 的部分 standalone 操作在异常结构或低性能设备上可能一直 pending。
 * 所有由按钮触发的 API 调用都通过这里设置上限，保证 UI 状态一定会恢复。
 */
export async function runKetcherOperation<T>(
  operation: () => T | PromiseLike<T>,
  timeoutMs = KETCHER_OPERATION_TIMEOUT_MS
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new KetcherOperationTimeoutError()), timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve().then(operation), timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Export the current canvas as standard (non-extended) SMILES.
 * Ketcher's export API is asynchronous; callers must await its Promise.
 */
export function getStandardSmiles(
  ketcher: KetcherStructureExporter,
  timeoutMs = KETCHER_OPERATION_TIMEOUT_MS
): Promise<string> {
  return runKetcherOperation(() => ketcher.getSmiles(false), timeoutMs);
}
