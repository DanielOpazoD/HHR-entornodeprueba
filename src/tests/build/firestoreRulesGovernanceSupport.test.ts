// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildFirestoreRulesGovernanceReport } from '../../../scripts/firestoreRulesGovernanceSupport.mjs';
import { collectRulesSourceGovernanceIssues } from '../../../scripts/rulesSourceGovernanceSupport.mjs';
import { normalizeGeneratedRuleFragment } from '../../../scripts/rulesSourceSupport.mjs';

describe('firestoreRulesGovernanceSupport', () => {
  const baseConfig = {
    version: 1,
    generatedRules: {
      file: 'firestore.rules',
      ownerAreaId: 'sync',
      maxLines: 4,
      minRemainingLines: 1,
      runbook: 'docs/CI_GATES_AND_FAILURE_RUNBOOKS.md',
    },
    fragments: [
      {
        path: 'rules/firestore/00-auth-and-role-helpers.rules',
        ownerAreaId: 'auth',
        risk: 'critical',
        reason: 'role resolution gates clinical access',
      },
      {
        path: 'rules/firestore/40-hospitals.rules',
        ownerAreaId: 'sync',
        risk: 'critical',
        reason: 'hospital document access paths',
      },
    ],
  };

  it('accepts a generated rules file whose fragments are fully owned and within budget', () => {
    const report = buildFirestoreRulesGovernanceReport('/repo', {
      config: baseConfig,
      ownershipAreaIds: new Set(['auth', 'sync']),
      firestoreSources: [
        'rules/firestore/00-auth-and-role-helpers.rules',
        'rules/firestore/40-hospitals.rules',
      ],
      countLines: (file: string) => (file === 'firestore.rules' ? 3 : 2),
      fileExists: () => true,
    });

    expect(report.issues).toEqual([]);
    expect(report.generatedRules).toMatchObject({
      file: 'firestore.rules',
      lines: 3,
      maxLines: 4,
      minRemainingLines: 1,
      remainingLines: 1,
      ownerAreaId: 'sync',
    });
  });

  it('reports budget drift, missing fragment ownership and unknown owner areas', () => {
    const report = buildFirestoreRulesGovernanceReport('/repo', {
      config: {
        ...baseConfig,
        generatedRules: {
          ...baseConfig.generatedRules,
          ownerAreaId: 'unknown-owner',
          maxLines: 2,
          minRemainingLines: 2,
        },
        fragments: [
          {
            path: 'rules/firestore/00-auth-and-role-helpers.rules',
            ownerAreaId: 'missing-owner',
            risk: 'critical',
            reason: 'role resolution gates clinical access',
          },
        ],
      },
      ownershipAreaIds: new Set(['auth', 'sync']),
      firestoreSources: [
        'rules/firestore/00-auth-and-role-helpers.rules',
        'rules/firestore/40-hospitals.rules',
      ],
      countLines: (file: string) => (file === 'firestore.rules' ? 3 : 2),
      fileExists: () => true,
    });

    expect(report.issues).toEqual([
      'firestore.rules has 3 lines; keep generated rules within the governed 2 line budget.',
      'firestore.rules has -1 remaining lines; keep at least 2 lines of governed headroom.',
      'firestore.rules references unknown ownerAreaId unknown-owner.',
      'rules/firestore/00-auth-and-role-helpers.rules references unknown ownerAreaId missing-owner.',
      'rules/firestore/40-hospitals.rules is missing ownership in scripts/config/firestore-rules-governance.json.',
    ]);
  });

  it('allows conflict snapshot review to admin and Hospitalizados HHR without opening writes', () => {
    const rules = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf8');

    expect(rules).toContain('function canManageClinicalConflictSnapshots()');
    expect(rules).toContain("return hasAnyEffectiveRole(['admin', 'nurse_hospital']);");
    expect(rules).toContain('match /conflictSnapshots/{snapshotId}');
    expect(rules).toContain('allow read: if canManageClinicalConflictSnapshots();');
    expect(rules).toContain('allow update, delete: if canAdminMaintainHospitalDocument();');
  });
});

describe('rulesSourceSupport', () => {
  it('strips generated-only blank lines and full-line comments without changing rule expressions', () => {
    expect(
      normalizeGeneratedRuleFragment(
        [
          "rules_version = '2';",
          '',
          '// review-only context',
          'service cloud.firestore {',
          '  allow read: if true; // inline comments remain attached to code',
          '}',
          '',
        ].join('\n'),
        { stripBlankLines: true, stripLineComments: true }
      )
    ).toBe(
      [
        "rules_version = '2';",
        'service cloud.firestore {',
        '  allow read: if true; // inline comments remain attached to code',
        '}',
        '',
      ].join('\n')
    );
  });

  it('collapses multiline string lists in generated rules while preserving other lists', () => {
    expect(
      normalizeGeneratedRuleFragment(
        [
          'return payload.keys().hasOnly([',
          "  'uid',",
          "  'email'",
          ']);',
          'return values.hasAny([',
          '  dynamicValue,',
          "  'fallback'",
          ']);',
        ].join('\n'),
        { collapseStringLists: true }
      )
    ).toBe(
      [
        "return payload.keys().hasOnly(['uid', 'email']);",
        'return values.hasAny([',
        '  dynamicValue,',
        "  'fallback'",
        ']);',
        '',
      ].join('\n')
    );
  });
});

describe('rules source governance', () => {
  const tempRoots: string[] = [];

  const writeText = (root: string, relativePath: string, value: string) => {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, value, 'utf8');
  };

  const createRulesRoot = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-source-governance-'));
    tempRoots.push(root);

    writeText(
      root,
      'rules/firestore/00-auth-and-role-helpers.rules',
      ['line 1', 'line 2'].join('\n')
    );
    writeText(
      root,
      'rules/firestore/40-hospitals.rules',
      ['line 1', 'line 2', 'line 3'].join('\n')
    );

    return root;
  };

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts Firestore rule fragments under the configured size limit', () => {
    const root = createRulesRoot();

    expect(
      collectRulesSourceGovernanceIssues(root, {
        firestoreSources: [
          'rules/firestore/00-auth-and-role-helpers.rules',
          'rules/firestore/40-hospitals.rules',
        ],
        maxFirestoreFragmentLines: 3,
      })
    ).toEqual([]);
  });

  it('reports Firestore rule fragments that exceed the configured size limit', () => {
    const root = createRulesRoot();

    expect(
      collectRulesSourceGovernanceIssues(root, {
        firestoreSources: [
          'rules/firestore/00-auth-and-role-helpers.rules',
          'rules/firestore/40-hospitals.rules',
        ],
        maxFirestoreFragmentLines: 2,
      })
    ).toEqual([
      'rules/firestore/40-hospitals.rules has 3 lines; split or simplify before exceeding 2 lines.',
    ]);
  });

  it('runs from the security check so rules debt cannot grow outside release gates', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts['check:security']).toContain(
      'node scripts/check-rules-source-governance.mjs'
    );
    expect(packageJson.scripts['check:security']).toContain(
      'npm run check:firestore-rules-governance'
    );
  });
});
