// @vitest-environment node
import { describe, expect, it } from 'vitest';

import '../../../extension/clinical-write-recovery-policy.js';

type RecoveryPolicy = {
  RECOVERY_DELAY_MS: number;
  RECOVERY_PREVIEW_TTL_MS: number;
  buildRecoveryResetTransition: () => Record<string, unknown>;
  evaluateConfirmationState: (input: Record<string, unknown>) => Record<string, unknown>;
  evaluatePreviewState: (input: Record<string, unknown>) => Record<string, unknown>;
  evaluateRecoveryTiming: (input: Record<string, unknown>) => Record<string, unknown>;
  parseRecoveryRequest: (input: Record<string, unknown>) => Record<string, unknown>;
  validateConfirmationChallenge: (input: Record<string, unknown>) => Record<string, unknown>;
  validateRecoveryMarker: (input: Record<string, unknown>) => Record<string, unknown>;
};

const policy = (
  globalThis as typeof globalThis & { HhrClinicalWriteRecoveryPolicy: RecoveryPolicy }
).HhrClinicalWriteRecoveryPolicy;
const generationId = '12121212-3434-4567-8abc-121212121212';
const challenge = '98989898-7676-4545-8abc-989898989898';
const challengeDigest = 'a'.repeat(64);
const reviewDigest = 'b'.repeat(64);
const changedReviewDigest = 'c'.repeat(64);
const now = Date.UTC(2026, 6, 15, 12, 0, 0);

describe('extension clinical write recovery policy', () => {
  it.each([
    ['handoff:141437', 'handoff', '141437', '', 'nursing'],
    ['handoff:medical:141437', 'handoff', '141437', '', 'medical'],
    ['score:141437:CUDYR', 'score', '141437', 'CUDYR', ''],
    ['score:141437:BRADEN', 'score', '141437', 'BRADEN', ''],
    ['score:141437:DOWNTON', 'score', '141437', 'DOWNTON', ''],
  ])(
    'parses %s without losing its clinical attribution',
    (key, kind, encId, instrument, requiredHandoffKind) => {
      expect(policy.parseRecoveryRequest({ key, generationId, phase: 'preview' })).toEqual({
        recovery: {
          key,
          generationId,
          phase: 'preview',
          recoveryToken: '',
          kind,
          encId,
          instrument,
          requiredHandoffKind,
        },
      });
    }
  );

  it.each([
    [{ key: 'handoff:abc', generationId, phase: 'preview' }],
    [{ key: 'score:141437:NEWS', generationId, phase: 'preview' }],
    [{ key: 'handoff:141437', generationId: 'short', phase: 'preview' }],
    [{ key: 'handoff:141437', generationId, phase: 'release' }],
    [{ key: 'handoff:141437', generationId, phase: 'confirm', recoveryToken: 'short' }],
  ])('rejects malformed recovery request %#', request => {
    expect(policy.parseRecoveryRequest(request)).toEqual({
      error: 'La solicitud para liberar la protección clínica no es válida.',
    });
  });

  it.each([
    ['preview', 'in-flight', true],
    ['preview', 'ambiguous', true],
    ['preview', 'awaiting-client-ack', true],
    ['preview', 'awaiting-recovery-confirm', true],
    ['preview', 'unknown', false],
    ['confirm', 'awaiting-recovery-confirm', true],
    ['confirm', 'ambiguous', false],
    ['confirm', 'awaiting-client-ack', false],
  ])('governs marker state %s/%s', (phase, state, accepted) => {
    const marker = { state, generationId };
    const result = policy.validateRecoveryMarker({
      protection: { active: true, marker },
      generationId,
      phase,
    });

    if (accepted) expect(result).toEqual({ marker });
    else expect(String(result.error)).toContain('protección cambió');
  });

  it('accepts recovery exactly at 60 seconds and reports the remaining wait before it', () => {
    expect(policy.RECOVERY_DELAY_MS).toBe(60_000);
    expect(
      policy.evaluateRecoveryTiming({
        marker: { createdAt: now - 60_000 },
        currentTime: now,
      })
    ).toEqual({ ok: true });
    expect(
      policy.evaluateRecoveryTiming({
        marker: { createdAt: now - 59_001 },
        currentTime: now,
      })
    ).toEqual({
      error: expect.stringContaining('Espera 1 s'),
    });
    expect(policy.evaluateRecoveryTiming({ marker: {}, currentTime: now })).toEqual({
      error: expect.stringContaining('fecha válida'),
    });
  });

  it('resets an expired confirmation without retaining its challenge material', () => {
    const result = policy.validateConfirmationChallenge({
      marker: {
        recoveryTokenHash: challengeDigest,
        recoveryReviewMac: reviewDigest,
        recoveryPreviewExpiresAt: now,
      },
      confirmedTokenHash: challengeDigest,
      currentTime: now,
    });

    expect(result).toEqual({
      error: expect.stringContaining('lectura fresca expiró'),
      resetTransition: policy.buildRecoveryResetTransition(),
    });
    expect(result.resetTransition).toMatchObject({
      state: 'ambiguous',
      recoveryTokenHash: '',
      recoveryReviewMac: '',
      recoveryPreviewedAt: 0,
      recoveryPreviewExpiresAt: 0,
    });
  });

  it('builds the exact five-minute preview transition and public response', () => {
    const result = policy.evaluatePreviewState({
      previewToken: challenge,
      tokenHash: challengeDigest,
      reviewMac: reviewDigest,
      review: { present: false },
      previewedAt: now,
      expiresAt: now + policy.RECOVERY_PREVIEW_TTL_MS,
    });

    expect(policy.RECOVERY_PREVIEW_TTL_MS).toBe(300_000);
    expect(result).toEqual({
      transition: {
        state: 'awaiting-recovery-confirm',
        receiptId: '',
        recoveryTokenHash: challengeDigest,
        recoveryReviewMac: reviewDigest,
        recoveryPreviewedAt: now,
        recoveryPreviewExpiresAt: now + 300_000,
      },
      response: {
        ok: true,
        recoveryPreview: { challenge, review: { present: false } },
      },
    });
  });

  it('clears only an exact reviewed generation and resets when the review changes', () => {
    const marker = {
      generationId,
      recoveryReviewMac: reviewDigest,
    };
    expect(
      policy.evaluateConfirmationState({
        marker,
        confirmedTokenHash: challengeDigest,
        currentReviewMac: reviewDigest,
      })
    ).toEqual({
      clearExpected: {
        state: 'awaiting-recovery-confirm',
        generationId,
        recoveryTokenHash: challengeDigest,
        recoveryReviewMac: reviewDigest,
      },
    });
    expect(
      policy.evaluateConfirmationState({
        marker,
        confirmedTokenHash: challengeDigest,
        currentReviewMac: changedReviewDigest,
      })
    ).toEqual({
      error: expect.stringContaining('registro cambió'),
      resetTransition: policy.buildRecoveryResetTransition(),
    });
  });

  it('exports a frozen policy surface', () => {
    expect(Object.isFrozen(policy)).toBe(true);
  });
});
