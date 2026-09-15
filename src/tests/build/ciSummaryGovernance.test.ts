import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readWorkflow = () =>
  fs.readFileSync(path.join(process.cwd(), '.github/workflows/ci-cd.yml'), 'utf8');

describe('CI summary governance', () => {
  it('fails closed when any required gate does not succeed', () => {
    const workflow = readWorkflow();
    const summaryJob = workflow.slice(
      workflow.indexOf('ci-strict-summary:'),
      workflow.indexOf('postmerge-evidence:')
    );
    const requiredResults = [
      ['CI_SCOPE_RESULT', "needs['ci-scope'].result"],
      ['QUALITY_STATIC_RESULT', "needs['quality-static'].result"],
      ['UNIT_RISK_RESULT', "needs['unit-risk'].result"],
      ['CLINICAL_SYNC_RESULT', "needs['clinical-sync-release-gate'].result"],
      ['RULES_EMULATOR_RESULT', "needs['rules-emulator'].result"],
      ['E2E_CRITICAL_RESULT', "needs['e2e-critical-emulator'].result"],
      ['BUILD_RESULT', 'needs.build.result'],
      ['CI_RUNTIME_TELEMETRY_RESULT', "needs['ci-runtime-telemetry'].result"],
    ] as const;

    expect(summaryJob).toContain('if: ${{ always() }}');
    for (const [variable, expression] of requiredResults) {
      expect(summaryJob).toContain(`${variable}: \${{ ${expression} }}`);
      expect(summaryJob).toContain(`$${variable}`);
    }
    expect(summaryJob).toContain("CI_SCOPE: ${{ needs['ci-scope'].outputs.scope }}");
    expect(summaryJob).toContain("DOCS_SCOPE_GATE_RESULT: ${{ needs['docs-scope-gate'].result }}");
    expect(summaryJob).toContain(
      "FUNCTIONS_SCOPE_GATE_RESULT: ${{ needs['functions-scope-gate'].result }}"
    );
    expect(summaryJob).toContain(
      'if [[ "$CI_SCOPE" == "docs-only" || "$CI_SCOPE" == "functions-only" ]]'
    );
    expect(summaryJob).toContain('expected_result="skipped"');
    expect(summaryJob).toContain('if [[ "$result" != "$expected_result" ]]');
    expect(summaryJob).toContain('failures=$((failures + 1))');
    expect(summaryJob).toContain('exit 1');
  });
});
