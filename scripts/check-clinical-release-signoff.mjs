#!/usr/bin/env node

import { collectClinicalReleaseCandidateIssues } from './clinicalReleaseSignoffSupport.mjs';

const issues = collectClinicalReleaseCandidateIssues(process.cwd());
if (issues.length > 0) {
  console.error('[clinical-release-signoff] Candidate signoff is incomplete:');
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}
console.log(
  '[clinical-release-signoff] Candidate-bound signoff record valid; reviewer identity is not independently authenticated.'
);
