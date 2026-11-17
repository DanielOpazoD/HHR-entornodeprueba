#!/usr/bin/env node
// Fails a main push whose main-only jobs did not run as ci-summary's result
// requires. NEEDS_JSON is the job's `toJSON(needs)`.
import { mainOnlyJobViolations } from './ciEvidenceReuseSupport.mjs';

let violations;
try {
  violations = mainOnlyJobViolations(JSON.parse(process.env.NEEDS_JSON ?? ''));
} catch {
  violations = ['NEEDS_JSON: missing or not JSON'];
}
for (const violation of violations) console.log(`::error::${violation}`);
if (violations.length > 0) {
  console.log(
    'A main-only job did not run as required; see "Jobs exclusivos de main" in docs/CI_GATES_AND_FAILURE_RUNBOOKS.md.'
  );
  process.exitCode = 1;
} else {
  console.log('Main-only jobs ran as required, or ci-summary did not pass and none was due.');
}
