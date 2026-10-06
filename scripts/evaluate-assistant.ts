/** Offline checks; no credentials, model calls or production data access. */
import { readFileSync, writeFileSync } from 'node:fs';
import { assertionSchema, candidateSchema, evaluateRegression } from '../src/lib/agent/regression';

const [casePath, candidatePath, reportPath] = process.argv.slice(2);
if (!casePath || !candidatePath) {
  console.error('Usage: npm run eval:assistant -- trace-case.json candidate.json [report.json]');
  process.exit(2);
}
try {
  const trace = JSON.parse(readFileSync(casePath, 'utf8'));
  if (!trace.badCase?.expected) throw new Error('Case must have reviewed expected behavior');
  const assertions = assertionSchema.parse(JSON.parse(trace.badCase.assertions));
  const candidate = candidateSchema.parse(JSON.parse(readFileSync(candidatePath, 'utf8')));
  const report = { caseId: trace.badCase.id, baselineRelease: trace.release, candidateRelease: candidate.release, ...evaluateRegression(assertions, candidate) };
  const output = JSON.stringify(report, null, 2);
  if (reportPath) writeFileSync(reportPath, output + '\n', 'utf8');
  console.log(output);
  process.exitCode = report.verdict === 'PASS' ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid input');
  process.exitCode = 2;
}
