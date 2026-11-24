// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { summarizeBackupImportOutcome } from '@/features/admin/services/dataMaintenanceService';
import {
  buildExamRequestOpenState,
  resolveExamRequestPrevision,
  toggleExamRequestSelection,
} from '@/features/census/components/exam-request/examRequestController';
import {
  buildDebouncedAuditKey,
  buildMeaningfulAuditDetails,
  mergeDebouncedAuditDetails,
} from '@/hooks/controllers/auditLogPolicyController';
import {
  buildBackupHandoffConfirmDescriptor,
  formatBackupExportDate,
} from '@/hooks/controllers/exportManagerConfirmController';
import {
  buildExportCsvNotification,
  buildExportJsonNotification,
  buildImportFileErrorNotification,
} from '@/hooks/controllers/fileOperationsFeedbackController';
import { hasCriticalLegacyRepairSignal } from '@/hooks/controllers/legacyRepairWarningController';
import { resolveStaleDayEditDecision } from '@/hooks/useStaleDayEditGuard';

describe('auditLogPolicyController', () => {
  it('builds a deterministic debounce key', () => {
    expect(buildDebouncedAuditKey('PATIENT_MODIFIED', 'R1')).toBe('PATIENT_MODIFIED-R1');
  });

  it('returns null when details are not meaningful', () => {
    expect(buildMeaningfulAuditDetails({ changes: {} })).toBeNull();
  });

  it('merges change chains preserving the first old value and last new value', () => {
    expect(
      mergeDebouncedAuditDetails(
        { changes: { status: { old: 'ESTABLE', new: 'GRAVE' } } },
        { changes: { status: { old: 'GRAVE', new: 'DE CUIDADO' } } }
      )
    ).toEqual({
      changes: { status: { old: 'ESTABLE', new: 'DE CUIDADO' } },
    });
  });
});

describe('backupImportFeedbackController', () => {
  it('summarizes repaired and partial imports', () => {
    expect(
      summarizeBackupImportOutcome({
        success: 2,
        failed: 0,
        repaired: 1,
        outcome: 'repaired',
      })
    ).toContain('1 requirieron reparación automática');

    expect(
      summarizeBackupImportOutcome({
        success: 2,
        failed: 1,
        repaired: 1,
        outcome: 'partial',
      })
    ).toContain('1 fallaron');
  });

  it('names the restored days whose per-episode clinical data did not come back', () => {
    const summary = summarizeBackupImportOutcome({
      success: 2,
      failed: 0,
      repaired: 0,
      outcome: 'partial',
      clinicalDerivedIncompleteDates: ['2026-11-02'],
    });

    expect(summary).toContain('No se restauraron los datos clínicos por episodio');
    expect(summary).toContain('1 día (2026-11-02)');
  });
});

describe('exportManagerConfirmController', () => {
  it('reverses YYYY-MM-DD into DD-MM-YYYY', () => {
    expect(formatBackupExportDate('2026-05-03')).toBe('03-05-2026');
  });

  it('builds the "Guardar" prompt for the first archive', () => {
    const descriptor = buildBackupHandoffConfirmDescriptor({
      recordDate: '2026-05-03',
      selectedShift: 'day',
      isArchived: false,
    });

    expect(descriptor.title).toBe('💾 Guardar Respaldo PDF');
    expect(descriptor.confirmText).toBe('Guardar');
    expect(descriptor.variant).toBe('info');
    expect(descriptor.message).toContain('03-05-2026');
    expect(descriptor.message).toMatch(/Turno/i);
  });

  it('builds the "Actualizar" prompt with overwrite warning when an archive already exists', () => {
    const descriptor = buildBackupHandoffConfirmDescriptor({
      recordDate: '2026-05-03',
      selectedShift: 'night',
      isArchived: true,
    });

    expect(descriptor.title).toBe('💾 Actualizar Respaldo PDF');
    expect(descriptor.confirmText).toBe('Actualizar');
    expect(descriptor.variant).toBe('warning');
    expect(descriptor.message).toMatch(/sobrescribir/i);
    expect(descriptor.message).toContain('03-05-2026');
    expect(descriptor.message).toMatch(/Turno/i);
  });
});

describe('fileOperationsFeedbackController', () => {
  it('builds export notifications', () => {
    expect(buildExportJsonNotification('success').title).toContain('exportados');
    expect(buildExportCsvNotification('error').channel).toBe('error');
  });

  it('builds import error notifications by reason', () => {
    expect(buildImportFileErrorNotification('invalid_format').message).toBe('Formato Inválido');
    expect(buildImportFileErrorNotification('processing_failed').title).toContain('procesar');
  });
});

describe('legacyRepairWarningController', () => {
  it('ignores minor legacy normalization rules', () => {
    expect(
      hasCriticalLegacyRepairSignal({
        compatibilityIntensity: 'moderate',
        migrationRulesApplied: ['legacy_nulls_normalized', 'schema_defaults_applied'],
      })
    ).toBe(false);
  });

  it('flags critical fallback repair rules', () => {
    expect(
      hasCriticalLegacyRepairSignal({
        compatibilityIntensity: 'high',
        migrationRulesApplied: ['salvage_patient_fallback_applied'],
      })
    ).toBe(true);
  });

  it('detects critical source compatibility repairs', () => {
    expect(
      hasCriticalLegacyRepairSignal({
        sourceCompatibilityIntensity: 'high',
        sourceMigrationRulesApplied: ['salvage_patient_fallback_applied'],
      })
    ).toBe(true);
  });
});

describe('resolveStaleDayEditDecision', () => {
  it('allows editing the clinical today', () => {
    expect(
      resolveStaleDayEditDecision({
        currentDateString: '2026-06-29',
        clinicalToday: '2026-06-29',
        alreadyConfirmed: false,
      })
    ).toBe('allowed');
  });

  it('requires confirmation for a previous day not yet confirmed', () => {
    expect(
      resolveStaleDayEditDecision({
        currentDateString: '2026-06-28',
        clinicalToday: '2026-06-29',
        alreadyConfirmed: false,
      })
    ).toBe('requires-confirmation');
  });

  it('allows a previous day once it has been confirmed (one prompt per day)', () => {
    expect(
      resolveStaleDayEditDecision({
        currentDateString: '2026-06-28',
        clinicalToday: '2026-06-29',
        alreadyConfirmed: true,
      })
    ).toBe('allowed');
  });
});

describe('examRequestController', () => {
  it('builds the open state with normalized insurance', () => {
    const result = buildExamRequestOpenState('Fonasa b');

    expect(result.selectedExams.size).toBe(0);
    expect(result.procedencia).toBe('Hospitalización');
    expect(result.prevision).toBe('FONASA B');
  });

  it('falls back to FONASA when insurance is missing', () => {
    expect(resolveExamRequestPrevision()).toBe('FONASA');
    expect(resolveExamRequestPrevision('   ')).toBe('FONASA');
  });

  it('toggles selection in a copy-safe way', () => {
    const initial = new Set(['HEMOGRAMA']);

    const added = toggleExamRequestSelection(initial, 'GLICEMIA');
    const removed = toggleExamRequestSelection(added, 'HEMOGRAMA');

    expect(initial.has('GLICEMIA')).toBe(false);
    expect(added.has('HEMOGRAMA')).toBe(true);
    expect(added.has('GLICEMIA')).toBe(true);
    expect(removed.has('HEMOGRAMA')).toBe(false);
    expect(removed.size).toBe(1);
  });
});
