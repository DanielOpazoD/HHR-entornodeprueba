import { describe, expect, it } from 'vitest';
import { resolveConflictSnapshotRecoveryState } from '@/features/census/controllers/conflictVersionsPresentationController';

describe('resolveConflictSnapshotRecoveryState', () => {
  it('classifies empty conflict recovery states using snapshot recovery evidence', () => {
    expect(
      resolveConflictSnapshotRecoveryState({
        date: '2026-07-01',
        snapshotCount: 0,
        snapshotRecovery: { status: 'failed', snapshotIds: [], origins: [], ttlMs: 172800000 },
      })
    ).toMatchObject({
      kind: 'not_saved',
      title: 'Snapshots no guardados',
    });

    expect(
      resolveConflictSnapshotRecoveryState({
        date: '2026-07-01',
        snapshotCount: 0,
        snapshotRecovery: {
          status: 'saved',
          snapshotIds: ['cid__remote_premerge', 'cid__incoming_premerge'],
          origins: ['remote_premerge', 'incoming_premerge'],
          ttlMs: 172800000,
        },
      })
    ).toMatchObject({
      kind: 'saved_but_unavailable',
      title: 'Snapshots no disponibles',
    });
  });

  it('distinguishes expired TTL from permission-denied snapshot recovery gaps', () => {
    expect(
      resolveConflictSnapshotRecoveryState({
        date: '2026-07-01',
        snapshotCount: 0,
        snapshotRecovery: {
          status: 'saved',
          snapshotIds: ['cid__remote_premerge'],
          origins: ['remote_premerge'],
          ttlMs: 172800000,
          expiresAt: '2026-07-02T00:00:00.000Z',
        },
        now: new Date('2026-07-03T00:00:00.000Z'),
      })
    ).toMatchObject({
      kind: 'expired_ttl',
      title: 'Snapshots expirados por TTL',
      message: expect.stringContaining('TTL'),
    });

    expect(
      resolveConflictSnapshotRecoveryState({
        date: '2026-07-01',
        snapshotCount: 0,
        snapshotRecovery: {
          status: 'saved',
          snapshotIds: ['cid__remote_premerge'],
          origins: ['remote_premerge'],
          ttlMs: 172800000,
          unavailableReason: 'permission_denied',
        },
      })
    ).toMatchObject({
      kind: 'permission_denied',
      title: 'Snapshots sin permiso de lectura',
      message: expect.stringContaining('sincroniza claims'),
    });
  });

  it('keeps the generic empty state explicit when no audit recovery evidence is available', () => {
    expect(
      resolveConflictSnapshotRecoveryState({
        date: '2026-07-01',
        snapshotCount: 0,
      })
    ).toMatchObject({
      kind: 'unknown_empty',
      title: 'Sin snapshots recuperables',
      message: expect.stringContaining('observabilidad'),
    });
  });

  it('surfaces query/index failures as actionable conflict-center states', () => {
    expect(
      resolveConflictSnapshotRecoveryState({
        date: '2026-07-03',
        snapshotCount: 0,
        snapshotRecovery: {
          status: 'failed',
          unavailableReason: 'query_index_missing',
        },
      })
    ).toMatchObject({
      kind: 'query_unavailable',
      title: 'Consulta de snapshots no disponible',
      message: expect.stringContaining('índice'),
    });

    expect(
      resolveConflictSnapshotRecoveryState({
        date: '2026-07-03',
        snapshotCount: 0,
        snapshotRecovery: {
          status: 'saved',
          snapshotIds: ['cid__remote_premerge'],
          origins: ['remote_premerge'],
          ttlMs: 172800000,
          unavailableReason: 'query_index_missing',
        },
      })
    ).toMatchObject({
      kind: 'query_unavailable',
      title: 'Consulta de snapshots no disponible',
      message: expect.stringContaining('índice'),
    });
  });
});
