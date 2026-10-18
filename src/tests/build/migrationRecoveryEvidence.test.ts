// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { inventoryDigest } from '../../../scripts/migration/inventoryCore.mjs';
import {
  assertRecoveryPlan,
  assertRecoveryReadback,
} from '../../../scripts/migration/recoveryEvidence.mjs';

const h = (value: string) => inventoryDigest(value);
const fixture = () => {
  const approval = {
    sourceProject: 'hhr-serviciohospitalizados',
    targetProject: 'hhr-pruebas',
    confirmedBy: 'Operador sintético',
    reason: 'Excepción individual confirmada',
    cases: [
      {
        caseId: 'synthetic-case',
        sourceVersion: 'source-v1',
        targetVersion: 'target-v2',
        sourceHash: h('source'),
        targetHash: h('target'),
        changes: [{ path: ['transfers', 0, 'evacuationMethod'], before: '', after: 'Aerocardal' }],
      },
    ],
  };
  return {
    approval,
    plan: { cases: structuredClone(approval.cases) },
    digest: inventoryDigest(approval),
  };
};
const readback = () => ({
  expectedVersion: 'target-v3',
  actualVersion: 'target-v3',
  expectedHash: h('after'),
  actualHash: h('after'),
  cudyrBeforeHash: h('cudyr'),
  cudyrAfterHash: h('cudyr'),
});

describe('private recovery evidence binding', () => {
  it('accepts only the exact approved plan, without mutating or disclosing it', () => {
    const data = fixture(),
      before = structuredClone(data);
    expect(assertRecoveryPlan(data.approval, data.plan, data.digest)).toEqual({
      cases: 1,
      planMatchesApproval: true,
      cloudWrites: 0,
      authorizesExecution: false,
    });
    expect(data).toEqual(before);
  });
  it.each(['extra', 'missing', 'value', 'version', 'hidden'])('rejects changed plan: %s', kind => {
    const { approval, plan, digest } = fixture();
    if (kind === 'extra') plan.cases.push({ ...plan.cases[0], caseId: 'unapproved' });
    if (kind === 'missing') plan.cases = [];
    if (kind === 'value') plan.cases[0].changes[0].after = 'Avión comercial';
    if (kind === 'version') plan.cases[0].targetVersion = 'new-version';
    if (kind === 'hidden') Object.assign(plan, { extraWrites: ['unapproved'] });
    expect(() => assertRecoveryPlan(approval, plan, digest)).toThrow('plan_approval_mismatch');
  });
  it('rejects an altered approval even if its plan was altered to match', () => {
    const { approval, plan, digest } = fixture();
    approval.reason = 'Altered authorization';
    expect(() => assertRecoveryPlan(approval, plan, digest)).toThrow('approval_digest_mismatch');
  });
  it.each(['empty', 'duplicate', 'project', 'confirmation', 'evidence'])(
    'rejects incomplete scope: %s',
    kind => {
      const { approval } = fixture();
      if (kind === 'empty') approval.cases = [];
      if (kind === 'duplicate') approval.cases.push(structuredClone(approval.cases[0]));
      if (kind === 'project') approval.targetProject = 'hhr-serviciohospitalizados';
      if (kind === 'confirmation') approval.confirmedBy = '';
      if (kind === 'evidence') approval.cases[0].targetHash = '';
      expect(() =>
        assertRecoveryPlan(approval, { cases: approval.cases }, inventoryDigest(approval))
      ).toThrow();
    }
  );
  it('binds admission exceptions to their exact fields rather than authorizing all timestamps', () => {
    const { approval } = fixture();
    approval.cases[0].changes = [
      { path: ['beds', 'R1', 'admissionTime'], before: '10:15', after: '23:00' },
    ];
    const digest = inventoryDigest(approval),
      plan = { cases: structuredClone(approval.cases) };
    expect(assertRecoveryPlan(approval, plan, digest).cases).toBe(1);
    plan.cases[0].changes.push({ path: ['transfers', 0, 'time'], before: '11:35', after: '11:20' });
    expect(() => assertRecoveryPlan(approval, plan, digest)).toThrow('plan_approval_mismatch');
  });
  it('accepts full readback evidence and rejects drift even with identical data', () => {
    expect(assertRecoveryReadback(readback()).cudyrEvidenceMatches).toBe(true);
    expect(() => assertRecoveryReadback({ ...readback(), actualVersion: 'target-v4' })).toThrow(
      'target_readback_mismatch'
    );
    expect(() => assertRecoveryReadback({ ...readback(), actualHash: h('different') })).toThrow(
      'target_readback_mismatch'
    );
    expect(() => assertRecoveryReadback({ ...readback(), cudyrAfterHash: h('changed') })).toThrow(
      'protected_cudyr_changed'
    );
    expect(() => assertRecoveryReadback({})).toThrow('readback_evidence_missing');
  });
  it('does not echo private fields on CLI success or malformed input', () => {
    const { approval, plan, digest } = fixture();
    const run = (input: string) =>
      spawnSync(process.execPath, ['scripts/migration/checkRecoveryPlan.mjs', digest], {
        input,
        encoding: 'utf8',
      });
    const success = run(JSON.stringify({ approval, plan, readback: readback() }));
    expect(success.status).toBe(0);
    expect(JSON.parse(success.stdout).readback.targetReadbackMatches).toBe(true);
    expect(success.stdout).not.toMatch(/synthetic-case|Aerocardal|transfers/);
    const failure = run('{"patientName":"PRIVATE_SENTINEL"');
    expect(failure.status).toBe(1);
    expect(failure.stdout + failure.stderr).not.toContain('PRIVATE_SENTINEL');
  });
});
