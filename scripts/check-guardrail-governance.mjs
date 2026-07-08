#!/usr/bin/env node

import {
  collectGuardrailGovernanceIssues,
  readGuardrailGovernanceSummary,
} from './guardrailGovernanceSupport.mjs';

const ROOT = process.cwd();

const fail = issues => {
  console.error('[guardrail-governance] Governance gaps found:');
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
};

const issues = collectGuardrailGovernanceIssues(ROOT);

if (issues.length > 0) {
  fail(issues);
}

const summary = readGuardrailGovernanceSummary(ROOT);
console.log(
  `[guardrail-governance] OK (${summary.blockingTierCount} blocking tiers, ${summary.reportOnlyCount} report-only guards)`
);
