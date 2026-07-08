#!/usr/bin/env node

import { evaluateSyncConvergenceEvidence } from './syncConvergenceEvidenceSupport.mjs';

const result = evaluateSyncConvergenceEvidence(process.cwd());

if (!result.ok) {
  console.error('[sync-convergence] Evidence contract failed:');
  result.sections.forEach(section => {
    section.checks
      .filter(check => !check.ok)
      .forEach(check => {
        console.error(`- ${section.id}.${check.id}: ${check.description}`);
        if (check.evidence.length > 0) {
          console.error(`  Evidence: ${check.evidence.join(', ')}`);
        }
      });
  });
  process.exit(1);
}

console.log('[sync-convergence] Evidence contract passed.');
