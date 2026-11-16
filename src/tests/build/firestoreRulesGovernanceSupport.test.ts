// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildFirestoreRulesGovernanceReport } from '../../../scripts/firestoreRulesGovernanceSupport.mjs';

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
});
