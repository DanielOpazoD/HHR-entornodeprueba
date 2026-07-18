// @vitest-environment node
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { beforeEach, describe, expect, it } from 'vitest';

type RecoveryMarker = {
  state: string;
  generationId: string;
  createdAt?: number;
  recoveryTokenHash?: string;
  recoveryReviewMac?: string;
  recoveryPreviewedAt?: number;
  recoveryPreviewExpiresAt?: number;
};

type RecoveryState = {
  protection: { active: boolean; marker: RecoveryMarker };
  reviewResult: Record<string, unknown>;
  freshReads: string[];
  transitionCalls: Array<{
    key: string;
    generationId: string;
    details: Record<string, unknown>;
  }>;
  clearCalls: Array<{ key: string; expected: Record<string, string> }>;
};

type RecoveryHandler = (request: {
  key: string;
  generationId: string;
  phase: 'preview' | 'confirm';
  recoveryToken?: string;
}) => Promise<Record<string, unknown>>;

const generationId = '12121212-3434-4567-8abc-121212121212';
const recoveryToken = '98989898-7676-4545-8abc-989898989898';
const backgroundSource = readFileSync(
  new URL('../../../extension/background.js', import.meta.url),
  'utf8'
);
const contentSource = readFileSync(
  new URL('../../../extension/content-prescription-print.js', import.meta.url),
  'utf8'
);

const loadRecovery = () => {
  const source = backgroundSource;
  const start = source.indexOf('const handleClinicalWriteRecoveryRequest = async');
  const end = source.indexOf('\n\nconst handleHospitalizedPrescriptionOptionsRequest', start);
  if (start < 0 || end < 0) throw new Error('No se encontró el recovery clínico.');

  const state: RecoveryState = {
    protection: {
      active: true,
      marker: { state: 'ambiguous', generationId, createdAt: Date.now() - 61_000 },
    },
    reviewResult: {
      review: {
        kind: 'handoff',
        present: true,
        value: 'Paciente estable y sin dolor',
        dateTime: '2026-07-15T10:40:00-06:00',
        author: 'Valeria Salfate',
      },
    },
    freshReads: [],
    transitionCalls: [],
    clearCalls: [],
  };
  const context = vm.createContext({ __state: state });
  vm.runInContext(
    `
    'use strict';
    const clinicalWriteLocks = new Set();
    const clinicalWriteAckLocks = new Set();
    const CLINICAL_WRITE_RECOVERY_DELAY_MS = 60 * 1000;
    const CLINICAL_WRITE_RECOVERY_PREVIEW_TTL_MS = 5 * 60 * 1000;
    const readClinicalWriteAmbiguity = async () => globalThis.__state.protection;
    const getFichaFetchInfo = async () => ({ info: {
      identityVerified: true, role: 'Enfermera(o)', practitionerRoleId: '2'
    } });
    const resolveSessionHandoffKind = info =>
      /enfermer/i.test(String(info && info.role || '')) ? 'nursing' : 'medical';
    const verifyEncounterStillHospitalized = async () => ({ ok: true, encounter: {} });
    const fetchFichaClaims = async () => ({ claims: [] });
    const hasFichaClaim = () => true;
    const createClinicalWriteRecoveryToken = () => '${recoveryToken}';
    const hashClinicalWriteRecoveryToken = async token =>
      globalThis.__hash(String(token || ''));
    const signClinicalWriteRecoveryReview = async (review, token, currentGenerationId) =>
      globalThis.__hmac(
        String(token || ''),
        JSON.stringify({ generationId: String(currentGenerationId || ''), review })
      );
    const readClinicalWriteRecoveryReview = async request => {
      globalThis.__state.freshReads.push(request.kind === 'handoff' ? 'handoff' : request.instrument);
      return globalThis.__state.reviewResult;
    };
    const transitionClinicalWriteAmbiguity = async (key, currentGenerationId, details) => {
      globalThis.__state.transitionCalls.push({ key, generationId: currentGenerationId, details });
      if (globalThis.__state.protection.marker.generationId !== currentGenerationId) {
        return { error: 'stale generation' };
      }
      Object.assign(globalThis.__state.protection.marker, details);
      return { ok: true };
    };
    const clearClinicalWriteAmbiguity = async (key, expected) => {
      globalThis.__state.clearCalls.push({ key, expected });
      return { ok: true };
    };
    ${source.slice(start, end)}
    globalThis.__recovery = handleClinicalWriteRecoveryRequest;
  `,
    context
  );
  (context as unknown as { __hash: (value: string) => string }).__hash = value =>
    createHash('sha256').update(value).digest('hex');
  (context as unknown as { __hmac: (key: string, value: string) => string }).__hmac = (
    key,
    value
  ) => createHmac('sha256', key).update(value).digest('hex');
  return {
    recovery: (context as unknown as { __recovery: RecoveryHandler }).__recovery,
    state,
  };
};

describe('extension clinical write recovery', () => {
  let recovery: RecoveryHandler;
  let state: RecoveryState;

  beforeEach(() => {
    ({ recovery, state } = loadRecovery());
  });

  it('uses the same recovery-token field in content and background routing', () => {
    expect(contentSource).toContain("['recoveryToken']: recoveryPreview.challenge");
    expect(backgroundSource).toContain('recoveryToken: message.recoveryToken');
  });

  it('does not preview an ambiguous write during the consistency window', async () => {
    state.protection.marker.createdAt = Date.now();
    const result = await recovery({
      key: 'handoff:141437',
      generationId,
      phase: 'preview',
    });

    expect(String(result.error)).toContain('aún puede estar actualizando');
    expect(state.freshReads).toEqual([]);
    expect(state.clearCalls).toEqual([]);
  });

  it('keeps protection when the marker has no valid creation date', async () => {
    delete state.protection.marker.createdAt;
    const result = await recovery({
      key: 'handoff:141437',
      generationId,
      phase: 'preview',
    });

    expect(String(result.error)).toContain('fecha válida');
    expect(state.freshReads).toEqual([]);
    expect(state.transitionCalls).toEqual([]);
    expect(state.clearCalls).toEqual([]);
  });

  it('does not release when the fresh preview read fails', async () => {
    state.reviewResult = { error: 'HTTP 503' };
    const result = await recovery({
      key: 'handoff:141437',
      generationId,
      phase: 'preview',
    });

    expect(result).toEqual({ error: 'HTTP 503' });
    expect(state.freshReads).toEqual(['handoff']);
    expect(state.transitionCalls).toEqual([]);
    expect(state.clearCalls).toEqual([]);
  });

  it('rejects a stale generation without making a clinical read', async () => {
    const result = await recovery({
      key: 'score:141437:BRADEN',
      generationId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      phase: 'preview',
    });

    expect(String(result.error)).toContain('protección cambió');
    expect(state.freshReads).toEqual([]);
    expect(state.clearCalls).toEqual([]);
  });

  it('returns the fresh review but persists only a token hash and HMAC', async () => {
    const result = await recovery({
      key: 'handoff:141437',
      generationId,
      phase: 'preview',
    });

    expect(result).toMatchObject({
      ok: true,
      recoveryPreview: {
        challenge: recoveryToken,
        review: { value: 'Paciente estable y sin dolor' },
      },
    });
    const persisted = state.transitionCalls[0]?.details || {};
    expect(persisted).toMatchObject({
      recoveryTokenHash: createHash('sha256').update(recoveryToken).digest('hex'),
      recoveryPreviewedAt: expect.any(Number),
      recoveryPreviewExpiresAt: expect.any(Number),
    });
    expect(String(persisted.recoveryReviewMac)).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(persisted)).not.toContain(recoveryToken);
    expect(JSON.stringify(persisted)).not.toContain('Paciente estable');
    expect(state.clearCalls).toEqual([]);
  });

  it('clears only after a second GET matches the exact preview the nurse reviewed', async () => {
    const preview = await recovery({
      key: 'score:141437:CUDYR',
      generationId,
      phase: 'preview',
    });
    const token = String((preview.recoveryPreview as { challenge?: string })?.challenge || '');
    const result = await recovery({
      key: 'score:141437:CUDYR',
      generationId,
      phase: 'confirm',
      recoveryToken: token,
    });

    expect(result).toEqual({ ok: true });
    expect(state.freshReads).toEqual(['CUDYR', 'CUDYR']);
    expect(state.clearCalls).toHaveLength(1);
    expect(state.clearCalls[0]).toMatchObject({
      key: 'score:141437:CUDYR',
      expected: {
        state: 'awaiting-recovery-confirm',
        generationId,
        recoveryTokenHash: createHash('sha256').update(recoveryToken).digest('hex'),
        recoveryReviewMac: expect.any(String),
      },
    });
  });

  it('keeps protection when the record changes after preview', async () => {
    await recovery({ key: 'handoff:141437', generationId, phase: 'preview' });
    state.reviewResult = {
      review: {
        kind: 'handoff',
        present: true,
        value: 'Nueva entrega posterior',
        dateTime: '2026-07-15T10:45:00-06:00',
        author: 'Valeria Salfate',
      },
    };
    const result = await recovery({
      key: 'handoff:141437',
      generationId,
      phase: 'confirm',
      recoveryToken,
    });

    expect(String(result.error)).toContain('cambió después');
    expect(state.clearCalls).toEqual([]);
    expect(state.transitionCalls.at(-1)?.details).toMatchObject({
      recoveryTokenHash: '',
      recoveryReviewMac: '',
      recoveryPreviewedAt: 0,
    });
  });

  it('rejects a wrong preview token before the second clinical GET', async () => {
    await recovery({ key: 'handoff:141437', generationId, phase: 'preview' });
    const result = await recovery({
      key: 'handoff:141437',
      generationId,
      phase: 'confirm',
      recoveryToken: 'abababab-cdcd-4efe-8abc-abababababab',
    });

    expect(String(result.error)).toContain('ya no coincide');
    expect(state.freshReads).toEqual(['handoff']);
    expect(state.clearCalls).toEqual([]);
  });
});
