import { describe, expect, it } from 'vitest';
import { resolveCensusOperationalState } from '@/features/census/controllers/censusOperationalStateController';

describe('censusOperationalStateController', () => {
  it('treats a present record as local cache while remote runtime is not ready', () => {
    expect(
      resolveCensusOperationalState({
        branch: 'register',
        bootstrapPhase: 'local_only',
        syncStatus: 'idle',
        hasRecord: true,
        isAuthenticated: true,
      })
    ).toMatchObject({
      phase: 'using_local_cache',
      isSettled: false,
      shouldShowBanner: false,
      severity: 'warning',
      message: expect.stringContaining('últimos datos'),
    });
  });

  it('marks a visible record as reconciling with friendly copy while resolution is still pending', () => {
    expect(
      resolveCensusOperationalState({
        branch: 'register',
        bootstrapPhase: 'remote_record_bootstrapping',
        syncStatus: 'idle',
        hasRecord: true,
        isAuthenticated: true,
      })
    ).toMatchObject({
      phase: 'reconciling_remote',
      isSettled: false,
      shouldShowBanner: false,
      severity: 'info',
      label: 'Actualizando censo',
      message: expect.stringContaining('últimos datos'),
    });
  });

  it('keeps operational census messages free of technical sync wording', () => {
    const states = [
      resolveCensusOperationalState({
        branch: 'register',
        bootstrapPhase: 'local_only',
        syncStatus: 'idle',
        hasRecord: true,
        isAuthenticated: true,
      }),
      resolveCensusOperationalState({
        branch: 'register',
        bootstrapPhase: 'remote_record_bootstrapping',
        syncStatus: 'idle',
        hasRecord: true,
        isAuthenticated: true,
      }),
      resolveCensusOperationalState({
        branch: 'empty',
        bootstrapPhase: 'remote_record_bootstrapping',
        syncStatus: 'idle',
        hasRecord: false,
        isAuthenticated: true,
      }),
      resolveCensusOperationalState({
        branch: 'empty',
        bootstrapPhase: 'confirmed_empty',
        syncStatus: 'idle',
        hasRecord: false,
        isAuthenticated: true,
      }),
    ];
    const forbiddenTechnicalWording = /firebase|remot[oa]|stale|cache|concurr/i;

    for (const state of states) {
      expect(`${state.label} ${state.message}`).not.toMatch(forbiddenTechnicalWording);
    }
  });

  it('does not show an operational banner once the remote-backed census is ready', () => {
    expect(
      resolveCensusOperationalState({
        branch: 'register',
        bootstrapPhase: 'record_ready',
        syncStatus: 'idle',
        hasRecord: true,
        isAuthenticated: true,
      })
    ).toMatchObject({
      phase: 'remote_confirmed',
      isSettled: true,
      shouldShowBanner: false,
    });
  });

  it('keeps empty days pending until absence is confirmed', () => {
    expect(
      resolveCensusOperationalState({
        branch: 'empty',
        bootstrapPhase: 'remote_record_bootstrapping',
        syncStatus: 'idle',
        hasRecord: false,
        isAuthenticated: true,
      })
    ).toMatchObject({
      phase: 'sync_pending',
      isSettled: false,
      shouldShowBanner: false,
      severity: 'warning',
    });

    expect(
      resolveCensusOperationalState({
        branch: 'empty',
        bootstrapPhase: 'confirmed_empty',
        syncStatus: 'idle',
        hasRecord: false,
        isAuthenticated: true,
      })
    ).toMatchObject({
      phase: 'confirmed_empty',
      isSettled: true,
      shouldShowBanner: false,
    });
  });

  it('prioritizes sync errors over availability phases', () => {
    expect(
      resolveCensusOperationalState({
        branch: 'register',
        bootstrapPhase: 'record_ready',
        syncStatus: 'error',
        hasRecord: true,
        isAuthenticated: true,
      })
    ).toMatchObject({
      phase: 'error',
      isSettled: false,
      shouldShowBanner: true,
      severity: 'error',
    });
  });
});
