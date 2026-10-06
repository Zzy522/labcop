import { z } from 'zod';

export const assertionSchema = z.object({
  contains: z.array(z.string().min(1).max(500)).max(20).default([]),
  excludes: z.array(z.string().min(1).max(500)).max(20).default([]),
  requiredTools: z.array(z.string().min(1).max(100)).max(20).default([]),
  forbiddenTools: z.array(z.string().min(1).max(100)).max(20).default([]),
  maxDurationMs: z.number().int().positive().max(3600000).optional(),
}).strict();
export const candidateSchema = z.object({
  release: z.string().min(1).max(200),
  output: z.string().max(200000),
  tools: z.array(z.string().max(100)).max(100),
  durationMs: z.number().int().nonnegative(),
  status: z.enum(['OK', 'ERROR', 'CANCELLED', 'TRUNCATED']),
}).strict();
export function evaluateRegression(assertions: z.infer<typeof assertionSchema>, candidate: z.infer<typeof candidateSchema>) {
  const checks = [
    { name: '运行成功', pass: candidate.status === 'OK' },
    ...assertions.contains.map(text => ({ name: `包含：${text}`, pass: candidate.output.includes(text) })),
    ...assertions.excludes.map(text => ({ name: `不包含：${text}`, pass: !candidate.output.includes(text) })),
    ...assertions.requiredTools.map(name => ({ name: `调用：${name}`, pass: candidate.tools.includes(name) })),
    ...assertions.forbiddenTools.map(name => ({ name: `禁止调用：${name}`, pass: !candidate.tools.includes(name) })),
    ...(assertions.maxDurationMs ? [{ name: `耗时 ≤ ${assertions.maxDurationMs}ms`, pass: candidate.durationMs <= assertions.maxDurationMs }] : []),
  ];
  const configured = assertions.contains.length + assertions.excludes.length + assertions.requiredTools.length + assertions.forbiddenTools.length + Number(!!assertions.maxDurationMs) > 0;
  return { verdict: !configured ? 'NEEDS_REVIEW' : checks.every(check => check.pass) ? 'PASS' : 'FAIL', checks, semanticReviewRequired: true };
}
