import { describe, expect, it } from 'vitest';
import { buildSyncHealthPackage } from '@/services/observability/syncHealthPackagePresenter';
import type {
  SyncConvergenceDiagnostic,
  SyncConvergenceFinding,
} from '@/services/observability/syncConvergenceDiagnostics';
import type { SyncRecoveryPlan } from '@/services/observability/syncRecoveryPlanner';

const makeFinding = (overrides: Partial<SyncConvergenceFinding> = {}): SyncConvergenceFinding => ({
  type: 'movement_not_reflected',
  status: 'needs_review',
  severity: 'critical',
  path: 'discharges.D1',
  module: 'censo',
  affectedPatient: 'Bernardo Orrego',
  message: 'Alta no reflejada.',
  evidence: {
    date: '2026-07-02',
    bedId: 'R1',
    rut: '17.274.300-5',
    pendingOutbox: false,
  },
  ...overrides,
});

const makeDiagnostic = (
  findings: SyncConvergenceFinding[],
  overrides: Partial<SyncConvergenceDiagnostic> = {}
): SyncConvergenceDiagnostic => ({
  status: 'needs_review',
  summary: 'Sincronización clínica needs_review: movement_not_reflected=1.',
  checkedAt: '2026-07-02T10:20:00.000Z',
  findings,
  ...overrides,
});

const makePlan = (overrides: Partial<SyncRecoveryPlan> = {}): SyncRecoveryPlan => ({
  status: 'needs_review',
  summary: 'Plan de recuperación.',
  actions: [
    {
      action: 'refresh_remote',
      safety: 'safe',
      target: 'discharges.D1',
      reason: 'Refrescar remoto',
      findingType: 'movement_not_reflected',
    },
    {
      action: 'restore_snapshot',
      safety: 'requires_confirmation',
      target: 'discharges.D1',
      reason: 'Snapshot disponible',
      findingType: 'movement_not_reflected',
    },
  ],
  ...overrides,
});

describe('syncHealthPackagePresenter', () => {
  it('groups findings by date, patient and module with human labels', () => {
    const diagnostic = makeDiagnostic([
      makeFinding(),
      makeFinding({
        type: 'handoff_divergent',
        module: 'medical_handoff',
        path: 'beds.R1.medicalHandoffEntries.mh-1',
        message: 'Entrada médica divergente.',
        evidence: {
          date: '2026-07-02',
          bedId: 'R1',
          rut: '17.274.300-5',
          entryId: 'mh-1',
        },
      }),
    ]);

    const healthPackage = buildSyncHealthPackage({
      diagnostic,
      recoveryPlan: makePlan(),
    });

    expect(healthPackage).toMatchObject({
      status: 'needs_review',
      statusLabel: 'Requiere revisión',
      summary: expect.stringContaining('2 hallazgo'),
      groups: [
        expect.objectContaining({
          title: 'Bernardo Orrego · 17.274.300-5 · R1',
          date: '2026-07-02',
          moduleKeys: ['censo', 'medical_handoff'],
          modules: ['Censo diario', 'Entrega médica'],
          highestSeverity: 'critical',
          findings: expect.arrayContaining([
            expect.objectContaining({ moduleLabel: 'Censo diario' }),
            expect.objectContaining({ moduleLabel: 'Entrega médica' }),
          ]),
        }),
      ],
    });
  });

  it('keeps no-bed findings separated by module while preserving patient context', () => {
    const diagnostic = makeDiagnostic([
      makeFinding({
        module: 'sync',
        path: 'syncQueue.mutation-1',
        message: 'Outbox pendiente.',
        evidence: {
          date: '2026-07-02',
          rut: '17.274.300-5',
          pendingOutbox: true,
        },
      }),
      makeFinding({
        type: 'handoff_divergent',
        module: 'medical_handoff',
        path: 'medicalHandoffBySpecialty.cirugia.note',
        message: 'Entrega médica divergente.',
        evidence: {
          date: '2026-07-02',
          rut: '17.274.300-5',
          specialty: 'cirugia',
        },
      }),
    ]);

    const healthPackage = buildSyncHealthPackage({
      diagnostic,
      recoveryPlan: makePlan(),
    });

    expect(healthPackage.groups).toHaveLength(2);
    expect(healthPackage.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Bernardo Orrego · 17.274.300-5',
          date: '2026-07-02',
          moduleKeys: ['sync'],
          modules: ['Sincronización local'],
        }),
        expect.objectContaining({
          title: 'Bernardo Orrego · 17.274.300-5',
          date: '2026-07-02',
          moduleKeys: ['medical_handoff'],
          modules: ['Entrega médica'],
        }),
      ])
    );
  });

  it('translates technical recovery actions into operator guidance', () => {
    const healthPackage = buildSyncHealthPackage({
      diagnostic: makeDiagnostic([makeFinding()]),
      recoveryPlan: makePlan({
        actions: [
          {
            action: 'retry_outbox',
            safety: 'safe',
            target: 'daily:2026-07-02',
            reason: 'Outbox pendiente',
          },
          {
            action: 'restore_snapshot',
            safety: 'requires_confirmation',
            target: 'discharges.D1',
            reason: 'Snapshot disponible',
          },
          {
            action: 'block_for_review',
            safety: 'manual_only',
            target: 'beds.R2',
            reason: 'Duplicado',
          },
        ],
      }),
    });

    expect(healthPackage.actions).toEqual([
      expect.objectContaining({
        action: 'retry_outbox',
        label: 'Reintentar cola local',
        operatorText: expect.stringContaining('segura'),
      }),
      expect.objectContaining({
        action: 'restore_snapshot',
        label: 'Revisar snapshot antes de preservar',
        operatorText: expect.stringContaining('confirmación'),
      }),
      expect.objectContaining({
        action: 'block_for_review',
        label: 'Bloquear y revisar manualmente',
        operatorText: expect.stringContaining('No autorresolver'),
      }),
    ]);
  });
});
