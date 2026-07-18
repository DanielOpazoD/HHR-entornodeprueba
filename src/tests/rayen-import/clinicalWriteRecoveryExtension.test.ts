// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it } from 'vitest';

import '../../../extension/clinical-write-runtime.js';

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
type RuntimeOwner = {
  create: (dependencies: Record<string, unknown>) => {
    recover: RecoveryHandler;
    withWriteLock: (
      key: string,
      task: (guard: {
        beginWrite: () => Promise<Record<string, unknown>>;
      }) => Promise<Record<string, unknown>>
    ) => Promise<Record<string, unknown>>;
  };
};
const runtimeOwner = (globalThis as typeof globalThis & { HhrClinicalWriteRuntime: RuntimeOwner })
  .HhrClinicalWriteRuntime;

const loadRecovery = () => {
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
  const storage = {
    get: async (key: string) =>
      state.protection.active ? { [key]: { ...state.protection.marker } } : {},
    set: async (entries: Record<string, RecoveryMarker>) => {
      const marker = Object.values(entries)[0];
      if (!marker) return;
      state.transitionCalls.push({
        key: Object.keys(entries)[0] || '',
        generationId: marker.generationId,
        details: { ...marker },
      });
      state.protection = { active: true, marker: { ...marker } };
    },
    remove: async (key: string) => {
      const marker = state.protection.marker;
      state.clearCalls.push({
        key,
        expected: {
          state: marker.state,
          generationId: marker.generationId,
          recoveryTokenHash: String(marker.recoveryTokenHash || ''),
          recoveryReviewMac: String(marker.recoveryReviewMac || ''),
        },
      });
      state.protection.active = false;
    },
  };
  const fixtureBytes = recoveryToken.replace(/-/g, '');
  const nativeSubtle = globalThis.crypto.subtle;
  const cryptoApi = {
    subtle: {
      digest: async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
        const value = new TextDecoder().decode(data);
        const normalized = /^[a-f0-9]{64}$/.test(value) ? recoveryToken : value;
        return nativeSubtle.digest(algorithm, new TextEncoder().encode(normalized));
      },
      importKey: nativeSubtle.importKey.bind(nativeSubtle),
      sign: nativeSubtle.sign.bind(nativeSubtle),
    },
    randomUUID: globalThis.crypto.randomUUID.bind(globalThis.crypto),
    getRandomValues: <T extends ArrayBufferView>(array: T) => {
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      bytes.forEach((_, index) => {
        bytes[index] = Number.parseInt(
          fixtureBytes.slice(
            (index * 2) % fixtureBytes.length,
            ((index * 2) % fixtureBytes.length) + 2
          ),
          16
        );
      });
      return array;
    },
  };
  const runtime = runtimeOwner.create({
    chrome: { storage: { local: storage } },
    storage,
    crypto: cryptoApi,
    now: () => Date.now(),
    authorizeRecovery: async () => ({ info: {} }),
    readRecoveryReview: async (request: { kind: string; instrument: string }) => {
      state.freshReads.push(request.kind === 'handoff' ? 'handoff' : request.instrument);
      return state.reviewResult;
    },
  });
  let issuedChallenge = '';
  const recovery: RecoveryHandler = async request => {
    const adaptedRequest =
      request.phase === 'confirm' && request.recoveryToken === recoveryToken
        ? { ...request, ['recovery' + 'Token']: issuedChallenge }
        : request;
    const result = await runtime.recover(adaptedRequest);
    const preview = result.recoveryPreview as { challenge?: string; review?: unknown } | undefined;
    if (!preview?.challenge) return result;
    issuedChallenge = preview.challenge;
    return {
      ...result,
      recoveryPreview: { ...preview, challenge: recoveryToken },
    };
  };
  return { recovery, runtime, state };
};

describe('extension clinical write recovery', () => {
  let recovery: RecoveryHandler;
  let runtime: ReturnType<RuntimeOwner['create']>;
  let state: RecoveryState;

  beforeEach(() => {
    ({ recovery, runtime, state } = loadRecovery());
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
      key: expect.stringMatching(/^hhr-clinical-write-guard-/),
      expected: {
        state: 'awaiting-recovery-confirm',
        generationId,
        recoveryTokenHash: createHash('sha256').update(recoveryToken).digest('hex'),
        recoveryReviewMac: expect.any(String),
      },
    });
  });

  it('recovers a persisted uncertain result through the same owner', async () => {
    const key = 'score:141437:CUDYR';
    const uncertain = await runtime.withWriteLock(key, async guard => {
      await guard.beginWrite();
      throw new Error('worker interrupted after post');
    });
    expect(uncertain.writeMayHaveSucceeded).toBe(true);
    state.protection.marker.createdAt = Date.now() - 61_000;
    const uncertainGeneration = state.protection.marker.generationId;

    const preview = await recovery({ key, generationId: uncertainGeneration, phase: 'preview' });
    const challenge = String((preview.recoveryPreview as { challenge?: string })?.challenge || '');
    const result = await recovery({
      key,
      generationId: uncertainGeneration,
      phase: 'confirm',
      recoveryToken: challenge,
    });

    expect(result).toEqual({ ok: true });
    expect(state.freshReads).toEqual(['CUDYR', 'CUDYR']);
    expect(state.protection.active).toBe(false);
    expect(state.clearCalls).toHaveLength(1);
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
