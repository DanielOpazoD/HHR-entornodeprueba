import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectGuardrailGovernanceIssues,
  collectReferencedScripts,
} from '../../../scripts/guardrailGovernanceSupport.mjs';

const tempRoots: string[] = [];

const writeJson = (root: string, relativePath: string, value: unknown) => {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const writeText = (root: string, relativePath: string, value = '') => {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
};

const createRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardrail-governance-'));
  tempRoots.push(root);

  writeJson(root, 'package.json', {
    scripts: {
      'ci:release-gate': 'npm run ci:merge-gate && npm run check:release-evidence',
      'ci:merge-gate': 'npm run check:quality',
      'check:quality': 'node scripts/check-quality-aggregate.mjs',
      'check:release-evidence': 'node scripts/check-release-evidence.mjs',
      'report:quality': 'node scripts/report-quality.mjs',
      'test:release-confidence': 'node scripts/run-release-confidence.mjs',
      'release-confidence:core': 'npm run test:rules:ci && npm run test:e2e:critical:ci',
      'test:rules:ci': 'vitest run rules',
      'test:e2e:critical:ci': 'playwright test',
    },
  });
  writeJson(root, 'scripts/config/release-confidence-pack.json', {
    steps: [{ command: 'npm run release-confidence:core' }],
  });
  writeJson(root, 'scripts/config/guardrail-governance.json', {
    version: 1,
    blockingTiers: [
      {
        id: 'release_gate',
        script: 'ci:release-gate',
        level: 'release-gate',
        requiredScripts: ['ci:merge-gate', 'check:release-evidence'],
      },
    ],
    releaseConfidence: {
      script: 'test:release-confidence',
      requiredScripts: ['test:rules:ci', 'test:e2e:critical:ci'],
    },
    qualityAggregate: {
      script: 'check:quality',
      checks: [{ id: 'check:release-evidence', group: 'governance' }],
    },
    reportOnly: [{ id: 'quality', script: 'report:quality', artifact: 'reports/quality.md' }],
  });
  writeText(root, 'reports/quality.md');

  return root;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('guardrail governance support', () => {
  it('accepts a coherent guardrail governance configuration', () => {
    const root = createRoot();

    expect(collectGuardrailGovernanceIssues(root)).toEqual([]);
  });

  it('detects when a blocking tier does not call its required script', () => {
    const root = createRoot();
    writeJson(root, 'package.json', {
      scripts: {
        'ci:release-gate': 'npm run ci:merge-gate',
        'ci:merge-gate': 'npm run check:quality',
        'check:quality': 'node scripts/check-quality-aggregate.mjs',
        'check:release-evidence': 'node scripts/check-release-evidence.mjs',
        'report:quality': 'node scripts/report-quality.mjs',
        'test:release-confidence': 'node scripts/run-release-confidence.mjs',
        'release-confidence:core': 'npm run test:rules:ci && npm run test:e2e:critical:ci',
        'test:rules:ci': 'vitest run rules',
        'test:e2e:critical:ci': 'playwright test',
      },
    });

    expect(collectGuardrailGovernanceIssues(root)).toContain(
      'blockingTiers.release_gate: ci:release-gate does not reference check:release-evidence'
    );
  });

  it('detects missing report-only artifacts', () => {
    const root = createRoot();
    fs.rmSync(path.join(root, 'reports/quality.md'));

    expect(collectGuardrailGovernanceIssues(root)).toContain(
      'reportOnly.quality: missing artifact reports/quality.md'
    );
  });

  it('expands nested release-confidence scripts transitively', () => {
    const scripts = {
      'release-confidence:core': 'npm run release-confidence:rules',
      'release-confidence:rules': 'npm run test:rules:ci',
      'test:rules:ci': 'vitest run rules',
    };

    expect([...collectReferencedScripts(scripts, ['release-confidence:core'])]).toContain(
      'test:rules:ci'
    );
  });
});
