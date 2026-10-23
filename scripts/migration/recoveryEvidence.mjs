import { isDeepStrictEqual } from 'node:util';
import { inventoryDigest, SOURCE_PROJECT, TARGET_PROJECT } from './inventoryCore.mjs';

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = code => {
  throw new Error(code);
};

/** Pure checks only: the approved digest must come from separately reviewed private evidence. */
export const assertRecoveryPlan = (approval, plan, approvedDigest) => {
  if (!object(approval) || !hash(approvedDigest) || inventoryDigest(approval) !== approvedDigest)
    fail('approval_digest_mismatch');
  if (approval.sourceProject !== SOURCE_PROJECT || approval.targetProject !== TARGET_PROJECT)
    fail('recovery_project_mismatch');
  if (!text(approval.confirmedBy) || !text(approval.reason)) fail('confirmation_missing');
  const cases = approval.cases;
  if (!Array.isArray(cases) || cases.length === 0) fail('empty_approved_scope');
  const ids = new Set();
  for (const entry of cases) {
    if (!object(entry) || !text(entry.caseId) || ids.has(entry.caseId))
      fail('invalid_case_identity');
    ids.add(entry.caseId);
    if (
      !text(entry.sourceVersion) ||
      !text(entry.targetVersion) ||
      !hash(entry.sourceHash) ||
      !hash(entry.targetHash) ||
      !Array.isArray(entry.changes) ||
      entry.changes.length === 0
    )
      fail('case_evidence_missing');
    // Paths and before/after values remain private; equality below binds all of them.
    for (const change of entry.changes) {
      if (
        !object(change) ||
        !Array.isArray(change.path) ||
        change.path.length === 0 ||
        !change.path.every(part => text(part) || (Number.isSafeInteger(part) && part >= 0)) ||
        !Object.hasOwn(change, 'before') ||
        !Object.hasOwn(change, 'after')
      )
        fail('invalid_approved_change');
    }
  }
  // No extra entries, ignored plan properties, different order, values or versions.
  if (!isDeepStrictEqual(plan, { cases })) fail('plan_approval_mismatch');
  return {
    cases: cases.length,
    planMatchesApproval: true,
    cloudWrites: 0,
    authorizesExecution: false,
  };
};

/** Caller supplies hashes covering the full expected record and the protected CUDYR baseline. */
export const assertRecoveryReadback = evidence => {
  if (!object(evidence)) fail('readback_evidence_missing');
  const {
    expectedVersion,
    actualVersion,
    expectedHash,
    actualHash,
    cudyrBeforeHash,
    cudyrAfterHash,
  } = evidence;
  if (
    ![expectedVersion, actualVersion].every(text) ||
    ![expectedHash, actualHash, cudyrBeforeHash, cudyrAfterHash].every(hash)
  )
    fail('readback_evidence_missing');
  if (expectedVersion !== actualVersion || expectedHash !== actualHash)
    fail('target_readback_mismatch');
  if (cudyrBeforeHash !== cudyrAfterHash) fail('protected_cudyr_changed');
  return { targetReadbackMatches: true, cudyrEvidenceMatches: true, cloudWrites: 0 };
};
