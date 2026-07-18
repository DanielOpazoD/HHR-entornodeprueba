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

const createRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardrail-governance-'));
  tempRoots.push(root);

  writeJson(root, 'package.json', {
    scripts: {
      'ci:release-gate': 'npm run ci:merge-gate && npm run check:release-evidence',
      'ci:merge-gate': 'npm run check:quality',
      'check:quality': 'node scripts/check-quality-aggregate.mjs',
      'check:release-evidence': 'node scripts/check-release-evidence.mjs',
      'report:quality-metrics': 'node scripts/report-quality-metrics.mjs',
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
    reportOnly: [
      {
        id: 'quality',
        script: 'report:quality-metrics',
        artifact: 'reports/quality-metrics.md',
      },
    ],
  });

  return root;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('guardrail governance support', () => {
  it('accepts a coherent configuration without materialized report-only artifacts', () => {
    const root = createRoot();

    expect(fs.existsSync(path.join(root, 'reports/quality-metrics.md'))).toBe(false);
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
        'report:quality-metrics': 'node scripts/report-quality-metrics.mjs',
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

  it('detects report-only artifacts not produced by their evidence graph command', () => {
    const root = createRoot();
    const configPath = path.join(root, 'scripts/config/guardrail-governance.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.reportOnly[0].artifact = 'reports/quality-metrics-typo.md';
    writeJson(root, 'scripts/config/guardrail-governance.json', config);

    expect(collectGuardrailGovernanceIssues(root)).toContain(
      'reportOnly.quality: reports/quality-metrics-typo.md is not produced by report:quality-metrics in the evidence dependency graph'
    );
  });

  it('detects report-only scripts missing from package.json', () => {
    const root = createRoot();
    const packagePath = path.join(root, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    delete packageJson.scripts['report:quality-metrics'];
    writeJson(root, 'package.json', packageJson);

    expect(collectGuardrailGovernanceIssues(root)).toContain(
      'reportOnly.quality: missing package.json script report:quality-metrics'
    );
  });

  it('detects report-only scripts absent from the evidence dependency graph', () => {
    const root = createRoot();
    const packagePath = path.join(root, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    packageJson.scripts['report:unknown'] = 'node scripts/report-unknown.mjs';
    writeJson(root, 'package.json', packageJson);

    const configPath = path.join(root, 'scripts/config/guardrail-governance.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.reportOnly[0] = {
      id: 'unknown',
      script: 'report:unknown',
      artifact: 'reports/unknown.md',
    };
    writeJson(root, 'scripts/config/guardrail-governance.json', config);

    expect(collectGuardrailGovernanceIssues(root)).toContain(
      'reportOnly.unknown: report:unknown is not declared in the evidence dependency graph'
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
