// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  classifyConflictChangedContexts,
  resolveConflictDomainContextForPath,
} from '@/services/repositories/conflictResolutionDomainPolicy';
import { createDailyRecordAggregate } from '@/services/repositories/dailyRecordAggregate';
import { resolveDailyRecordReadConsistency } from '@/services/repositories/dailyRecordConsistencyPolicy';
import {
  DAILY_RECORD_DELETE_OUTBOX_POLICY,
  shouldQueueDailyRecordDeleteOutbox,
} from '@/services/repositories/dailyRecordDeletionService';
import {
  createCopyPatientToDateCommand,
  createDeleteDayCommand,
  createInitializeDayCommand,
} from '@/services/repositories/contracts/dailyRecordLifecycleCommands';
import {
  buildFieldShrinkageBlockedPartialUpdateResult,
  buildMissingBasePartialUpdateResult,
} from '@/services/repositories/dailyRecordRepositoryWriteService';
import {
  PATIENT_SYNC_OWNERSHIP_FIELDS,
  resolveDailyRecordSyncOwnership,
  SYNC_OWNERSHIP_POLICY_VERSION,
} from '@/services/repositories/dailyRecordSyncOwnershipPolicy';
import {
  buildRecoveryTaskMeta,
  resolveEffectiveChangedPaths,
  resolveRetryOrigin,
} from '@/services/repositories/dailyRecordWriteRecoveryController';
import {
  buildSchemaEvolutionLedgerSummary,
  getSchemaEvolutionLedger,
} from '@/services/repositories/migrationLedger';
import { assessSchemaCompatibility } from '@/services/repositories/schemaEvolutionPolicy';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const buildRecord = (overrides: Partial<DailyRecord> = {}): DailyRecord =>
  ({
    date: '2026-03-07',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '2026-03-07T08:00:00.000Z',
    nurses: ['', ''],
    nursesDayShift: ['', ''],
    nursesNightShift: ['', ''],
    tensDayShift: ['', '', ''],
    tensNightShift: ['', '', ''],
    activeExtraBeds: [],
    ...overrides,
  }) as DailyRecord;

describe('conflictResolutionDomainPolicy', () => {
  it('classifies handoff paths inside beds as handoff context', () => {
    expect(resolveConflictDomainContextForPath('beds.R1.handoffNoteDayShift')).toBe('handoff');
    expect(resolveConflictDomainContextForPath('beds.R1.handoffNoteNightShift')).toBe('handoff');
    expect(resolveConflictDomainContextForPath('beds.R1.medicalHandoffEntries')).toBe('handoff');
    expect(resolveConflictDomainContextForPath('beds.R1.medicalHandoffNote')).toBe('handoff');
    expect(resolveConflictDomainContextForPath('medicalHandoffBySpecialty.cirugia')).toBe(
      'handoff'
    );
  });

  it('keeps non-handoff bed paths clinical and combines mixed contexts without duplicates', () => {
    expect(resolveConflictDomainContextForPath('beds.R1.pathology')).toBe('clinical');
    expect(resolveConflictDomainContextForPath('discharges')).toBe('movements');
    expect(resolveConflictDomainContextForPath('nursesDayShift')).toBe('staffing');

    expect(
      classifyConflictChangedContexts([
        'beds.R1.handoffNoteDayShift',
        'beds.R1.pathology',
        'medicalHandoffBySpecialty.cirugia',
      ])
    ).toEqual(['handoff', 'clinical']);
  });
});

describe('dailyRecordAggregate', () => {
  it('exposes canonical staffing facets with legacy-compatible fallbacks', () => {
    const aggregate = createDailyRecordAggregate(
      buildRecord({
        nurses: ['Legacy A', 'Legacy B'],
        nursesDayShift: ['', ''],
        nursesNightShift: ['Noche 1', ''],
      })
    );

    expect(aggregate.staffing.nursesDay).toEqual(['Legacy A', 'Legacy B']);
    expect(aggregate.staffing.nursesNight).toEqual(['Noche 1']);
  });
});

describe('dailyRecordConsistencyPolicy', () => {
  it('marks local record as authoritative when it is newer than remote', () => {
    const local = buildRecord({ date: '2026-03-15', lastUpdated: '2026-03-15T10:00:00.000Z' });
    const remote = buildRecord({ date: '2026-03-15', lastUpdated: '2026-03-15T08:00:00.000Z' });

    const result = resolveDailyRecordReadConsistency({
      localRecord: local,
      remoteRecord: remote,
      selectedRecord: local,
      remoteAvailability: 'resolved',
    });

    expect(result.consistencyState).toBe('local_authoritative');
    expect(result.recoveryAction).toBe('defer_remote_sync');
    expect(result.conflictSummary?.kind).toBe('remote_stale');
  });
});

describe('dailyRecordDeleteOutboxPolicy', () => {
  it('codifies delete/moveToTrash as non-outbox lifecycle cleanup until offline delete is required', () => {
    expect(shouldQueueDailyRecordDeleteOutbox()).toBe(false);
    expect(DAILY_RECORD_DELETE_OUTBOX_POLICY.requiresTransactionalOutbox).toBe(false);
    expect(DAILY_RECORD_DELETE_OUTBOX_POLICY.remoteMode).toBe('best_effort_soft_delete');
    expect(DAILY_RECORD_DELETE_OUTBOX_POLICY.reviewTriggers).toContain('offline_delete_required');
  });
});

describe('dailyRecordLifecycleCommands contracts', () => {
  it('creates initializeDay command with valid dates', () => {
    const command = createInitializeDayCommand('2026-02-19', '2026-02-18');
    expect(command.date).toBe('2026-02-19');
    expect(command.copyFromDate).toBe('2026-02-18');
  });

  it('rejects initializeDay command with invalid copyFromDate', () => {
    expect(() => createInitializeDayCommand('2026-02-19', '19-02-2026')).toThrow(
      /Invalid date format/
    );
  });

  it('creates deleteDay command for valid date', () => {
    const command = createDeleteDayCommand('2026-02-19');
    expect(command.date).toBe('2026-02-19');
  });

  it('creates copyPatientToDate command for valid input', () => {
    const command = createCopyPatientToDateCommand('2026-02-18', 'R1', '2026-02-19', 'R2');
    expect(command.sourceBedId).toBe('R1');
    expect(command.targetBedId).toBe('R2');
  });

  it('rejects copyPatientToDate command with empty bed id', () => {
    expect(() => createCopyPatientToDateCommand('2026-02-18', '', '2026-02-19', 'R2')).toThrow(
      /non-empty bed id/
    );
  });
});

describe('dailyRecordPartialUpdateBlockingController', () => {
  it('builds the canonical blocked result when no base record can be found', () => {
    expect(buildMissingBasePartialUpdateResult('2026-05-28')).toEqual({
      date: '2026-05-28',
      savedHere: false,
      state: 'not_saved',
      reason: 'blocked',
      userSafeMessage: 'No se encontró un registro local válido para aplicar el cambio.',
      blockingError: undefined,
    });
  });

  it('builds the canonical blocked result for suspicious clinical text shrinkage', () => {
    const result = buildFieldShrinkageBlockedPartialUpdateResult('2026-05-28', [
      { path: 'beds.R1.pathology', prevLength: 100, nextLength: 25 },
      { path: 'beds.R1.medicalHandoffNote', prevLength: 80, nextLength: 10 },
    ]);

    expect(result).toMatchObject({ savedHere: false, state: 'not_saved', reason: 'blocked' });
    expect(result.blockingError?.name).toBe('DataRegressionError');
    expect(result.userSafeMessage).toContain('100 -> 25');
    expect(result.blockingError?.message).toBe(result.userSafeMessage);
  });
});

describe('dailyRecordSyncOwnershipPolicy', () => {
  it('classifies patient fields through a central ownership matrix', () => {
    expect(SYNC_OWNERSHIP_POLICY_VERSION).toBe('2026-05-daily-record-v2');
    expect(resolveDailyRecordSyncOwnership('beds.R1.patientName')).toBe('remoteCanonical');
    expect(resolveDailyRecordSyncOwnership('beds.R1.rut')).toBe('remoteCanonical');
    expect(resolveDailyRecordSyncOwnership('beds.R1.pathology')).toBe('remoteCanonical');
    expect(resolveDailyRecordSyncOwnership('beds.R1.specialty')).toBe('remoteCanonical');
    expect(resolveDailyRecordSyncOwnership('beds.R1.status')).toBe('remoteCanonical');
    expect(resolveDailyRecordSyncOwnership('beds.R1.upcChecklist')).toBe('remoteCanonical');
    expect(resolveDailyRecordSyncOwnership('beds.R1.bedMode')).toBe('adminRemote');
    expect(resolveDailyRecordSyncOwnership('beds.R1.location')).toBe('adminRemote');
    expect(resolveDailyRecordSyncOwnership('beds.R1.clinicalCrib')).toBe('movementInvariant');
    expect(resolveDailyRecordSyncOwnership('beds.R1.clinicalSyncCheckpoint')).toBe('mergeById');
    expect(resolveDailyRecordSyncOwnership('beds.R1.handoffNote')).toBe('localNarrative');
    expect(resolveDailyRecordSyncOwnership('beds.R1.medicalHandoffNote')).toBe('localNarrative');
    expect(resolveDailyRecordSyncOwnership('discharges')).toBe('mergeById');
    expect(resolveDailyRecordSyncOwnership('transfers')).toBe('mergeById');
    expect(resolveDailyRecordSyncOwnership('beds.R1.unknown')).toBe('default');
  });

  it('does not leave known patient fields without an explicit sync ownership', () => {
    expect(PATIENT_SYNC_OWNERSHIP_FIELDS.length).toBeGreaterThan(40);

    PATIENT_SYNC_OWNERSHIP_FIELDS.forEach(field => {
      expect(resolveDailyRecordSyncOwnership(`beds.R1.${field}`)).not.toBe('default');
    });
  });
});

describe('dailyRecordWriteRecoveryController', () => {
  it('falls back to wildcard path when changed paths are empty', () => {
    expect(resolveEffectiveChangedPaths([])).toEqual(['*']);
  });

  it('resolves retry origin from effective changed paths', () => {
    expect(resolveRetryOrigin([])).toBe('full_save_retry');
    expect(resolveRetryOrigin(['beds.R1.patientName'])).toBe('partial_update_retry');
  });

  it('builds recovery task meta from changed paths and origin', () => {
    expect(buildRecoveryTaskMeta(['beds.R1.patientName'], 'partial_update_retry')).toEqual({
      contexts: ['clinical'],
      origin: 'partial_update_retry',
      syncContract: {
        changedPaths: ['beds.R1.patientName'],
      },
    });
  });
});

describe('migrationLedger', () => {
  it('builds a stable summary from the schema evolution ledger', () => {
    const ledger = getSchemaEvolutionLedger();
    const summary = buildSchemaEvolutionLedgerSummary();

    expect(summary.totalSteps).toBe(ledger.length);
    expect(summary.firstVersion).toBe(ledger[0]?.fromVersion ?? 0);
    expect(summary.currentVersion).toBe(ledger.at(-1)?.toVersion ?? 0);
    expect(summary.labels).toEqual(ledger.map(step => step.label));
  });
});

describe('schemaEvolutionPolicy', () => {
  it('marks missing versions as legacy bridge candidates', () => {
    const assessment = assessSchemaCompatibility({});
    expect(assessment.disposition).toBe('legacy_bridge');
    expect(assessment.requiresMigration).toBe(true);
    expect(assessment.legacyBridgeCandidate).toBe(true);
  });

  it('marks current records as current', () => {
    const assessment = assessSchemaCompatibility({ schemaVersion: 1 });
    expect(assessment.disposition).toBe('current');
    expect(assessment.requiresMigration).toBe(false);
  });

  it('marks ahead-of-runtime records as forward incompatible', () => {
    const assessment = assessSchemaCompatibility({ schemaVersion: 2 });
    expect(assessment.disposition).toBe('forward_incompatible');
    expect(assessment.aheadOfRuntime).toBe(true);
  });
});
