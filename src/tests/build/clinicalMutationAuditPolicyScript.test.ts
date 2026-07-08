import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  detectIgnoredAuditOutcomes,
  evaluateAuditPolicy,
  findMissingLinkedFiles,
  parseAuditActions,
} from '../../../scripts/check-clinical-mutation-audit-policy.mjs';

const basePolicy = {
  failClosed: [{ action: 'ACTION_A', test: 'src/tests/foo.test.ts' }],
  bestEffortObservable: [
    { action: 'ACTION_B', justification: 'urgent clinical flow, abort harms care' },
  ],
  exemptNonMutation: ['ACTION_C'],
};

describe('check-clinical-mutation-audit-policy', () => {
  describe('parseAuditActions', () => {
    it('extracts the union members', () => {
      const src = "export type AuditAction =\n  | 'PATIENT_ADMITTED'\n  | 'VIEW_PATIENT';\n";
      expect(parseAuditActions(src)).toEqual(['PATIENT_ADMITTED', 'VIEW_PATIENT']);
    });

    it('extracts members regardless of quote style or naming convention', () => {
      // The gate must not be bypassable by a future action that breaks the UPPER_SNAKE convention.
      const src = 'export type AuditAction =\n  | "PATIENT_ADMITTED"\n  | \'data_imported\';\n';
      expect(parseAuditActions(src)).toEqual(['PATIENT_ADMITTED', 'data_imported']);
    });

    it('returns null when the union is absent', () => {
      expect(parseAuditActions('export type Something = string;')).toBeNull();
    });
  });

  describe('evaluateAuditPolicy', () => {
    it('passes when every action is classified exactly once', () => {
      expect(
        evaluateAuditPolicy({ actions: ['ACTION_A', 'ACTION_B', 'ACTION_C'], policy: basePolicy })
      ).toEqual([]);
    });

    it('fails on an unclassified action (forces a posture decision)', () => {
      const errors = evaluateAuditPolicy({
        actions: ['ACTION_A', 'ACTION_B', 'ACTION_C', 'ACTION_NEW'],
        policy: basePolicy,
      });
      expect(errors.join('\n')).toContain('ACTION_NEW');
    });

    it('fails when an action is declared in two buckets', () => {
      const errors = evaluateAuditPolicy({
        actions: ['ACTION_A', 'ACTION_B', 'ACTION_C'],
        policy: { ...basePolicy, exemptNonMutation: ['ACTION_C', 'ACTION_A'] },
      });
      expect(errors.join('\n')).toContain('two buckets');
    });

    it('fails when a best-effort action lacks a real justification', () => {
      const errors = evaluateAuditPolicy({
        actions: ['ACTION_A', 'ACTION_B', 'ACTION_C'],
        policy: {
          ...basePolicy,
          bestEffortObservable: [{ action: 'ACTION_B', justification: 'x' }],
        },
      });
      expect(errors.join('\n')).toContain('justification');
    });

    it('fails on a stale policy entry not in the union', () => {
      const errors = evaluateAuditPolicy({ actions: ['ACTION_A', 'ACTION_C'], policy: basePolicy });
      expect(errors.join('\n')).toContain('stale');
    });

    it('fails when a failClosed action does not link a proving test', () => {
      const errors = evaluateAuditPolicy({
        actions: ['ACTION_A', 'ACTION_B', 'ACTION_C'],
        policy: { ...basePolicy, failClosed: [{ action: 'ACTION_A' }] },
      });
      expect(errors.join('\n')).toContain('must link a "test"');
    });

    it('fails when the linked failClosed test is not a src/tests test file', () => {
      const errors = evaluateAuditPolicy({
        actions: ['ACTION_A', 'ACTION_B', 'ACTION_C'],
        policy: { ...basePolicy, failClosed: [{ action: 'ACTION_A', test: 'package.json' }] },
      });
      expect(errors.join('\n')).toContain('must link a "test"');
    });

    it('classifies serverSideEnforced and requires an emitter under functions/', () => {
      expect(
        evaluateAuditPolicy({
          actions: ['ACTION_A', 'ACTION_B', 'ACTION_C', 'ACTION_D'],
          policy: {
            ...basePolicy,
            serverSideEnforced: [{ action: 'ACTION_D', emitter: 'functions/lib/x.js' }],
          },
        })
      ).toEqual([]);

      const bad = evaluateAuditPolicy({
        actions: ['ACTION_A', 'ACTION_B', 'ACTION_C', 'ACTION_D'],
        policy: { ...basePolicy, serverSideEnforced: [{ action: 'ACTION_D' }] },
      });
      expect(bad.join('\n')).toContain('must declare an "emitter"');
    });

    it('rejects a failClosed test path that escapes src/tests via traversal', () => {
      const errors = evaluateAuditPolicy({
        actions: ['ACTION_A', 'ACTION_B', 'ACTION_C'],
        policy: {
          ...basePolicy,
          failClosed: [{ action: 'ACTION_A', test: 'src/tests/../fixtures/proof.test.ts' }],
        },
      });
      expect(errors.join('\n')).toContain('must link a "test"');
    });
  });

  describe('findMissingLinkedFiles', () => {
    it('flags a failClosed test and a serverSide emitter that do not exist', () => {
      const errors = findMissingLinkedFiles({
        failClosed: [{ action: 'A', test: 'src/tests/missing.test.ts' }] as never,
        serverSideEnforced: [{ action: 'B', emitter: 'functions/missing.js' }] as never,
        fileExists: () => false,
      });
      expect(errors.join('\n')).toContain('missing test file');
      expect(errors.join('\n')).toContain('missing emitter file');
    });

    it('passes when the linked files exist', () => {
      expect(
        findMissingLinkedFiles({
          failClosed: [{ action: 'A', test: 'src/tests/x.test.ts' }] as never,
          serverSideEnforced: [{ action: 'B', emitter: 'functions/x.js' }] as never,
          fileExists: () => true,
        })
      ).toEqual([]);
    });
  });

  describe('detectIgnoredAuditOutcomes (compliance: the silent-drop bug class)', () => {
    it('flags a bare await whose outcome is discarded', () => {
      const src = 'async function f() {\n  await executeWriteAuditEvent({ action: "X" });\n}';
      expect(detectIgnoredAuditOutcomes(src)).toHaveLength(1);
    });

    it('flags a void-discarded call', () => {
      expect(detectIgnoredAuditOutcomes('void executeWriteAuditEvent(x);')).toHaveLength(1);
    });

    it('accepts an assigned outcome', () => {
      expect(
        detectIgnoredAuditOutcomes('const outcome = await executeWriteAuditEvent({ action: "X" });')
      ).toEqual([]);
    });

    it('accepts a returned outcome (with or without await)', () => {
      expect(detectIgnoredAuditOutcomes('return await executeWriteAuditEvent(x);')).toEqual([]);
      expect(detectIgnoredAuditOutcomes('const f = () => executeWriteAuditEvent(x);')).toEqual([]);
    });

    it('ignores imports and type references (not a call)', () => {
      const src =
        "import { executeWriteAuditEvent } from '@/x';\n" +
        'type W = typeof executeWriteAuditEvent;\n' +
        'let w: Parameters<typeof executeWriteAuditEvent>[0];';
      expect(detectIgnoredAuditOutcomes(src)).toEqual([]);
    });
  });

  it('the committed registry classifies every real AuditAction (no drift)', () => {
    const actions = parseAuditActions(
      fs.readFileSync(path.join(process.cwd(), 'src/types/auditActionTypes.ts'), 'utf8')
    );
    const policy = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), 'scripts/clinical-mutation-audit-policy.json'),
        'utf8'
      )
    );
    expect(evaluateAuditPolicy({ actions, policy })).toEqual([]);
  });
});
