import { readFileSync } from 'node:fs';
import { assertRecoveryPlan, assertRecoveryReadback } from './recoveryEvidence.mjs';

try {
  if (process.argv.length !== 3) throw new Error('approved_digest_required');
  const { approval, plan, readback } = JSON.parse(readFileSync(0, 'utf8'));
  const result = assertRecoveryPlan(approval, plan, process.argv[2]);
  console.log(
    JSON.stringify({
      ...result,
      readback: readback === undefined ? 'not_provided' : assertRecoveryReadback(readback),
    })
  );
} catch {
  // Never echo private input, patient values, paths or parser errors into CI/logs.
  console.error('Comprobación detenida: revise aprobación, plan y evidencia. Sin escrituras.');
  process.exitCode = 1;
}
