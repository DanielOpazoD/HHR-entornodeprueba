import { describe, expect, it } from 'vitest';

import { buildDischargeDiagnosisChangeAuditDetails } from '@/services/admin/auditClinicalEventCatalog';
import { buildClinicalAuditPresentation } from '@/services/admin/clinicalAuditPresentation';
import type { AuditLogEntry } from '@/types/auditLogTypes';

describe('clinical discharge diagnosis audit', () => {
  it('builds explicit clinical details for discharge diagnosis changes', () => {
    expect(
      buildDischargeDiagnosisChangeAuditDetails({
        patientName: 'Paciente Uno',
        movementId: 'd-1',
        movementLabel: 'Alta',
        previousDiagnosis: 'Neumonia',
        nextDiagnosis: 'Neumonia resuelta',
      })
    ).toEqual({
      clinicalEvent: 'Actualización de diagnóstico de egreso',
      patientName: 'Paciente Uno',
      movementId: 'd-1',
      movementLabel: 'Alta',
      changes: {
        diagnosis: {
          old: 'Neumonia',
          new: 'Neumonia resuelta',
        },
      },
    });
  });

  it('presents diagnosis changes in clinical language instead of raw action names', () => {
    const log: AuditLogEntry = {
      id: 'audit-1',
      userId: 'doctor@example.com',
      action: 'PATIENT_DISCHARGE_DIAGNOSIS_CHANGED',
      entityType: 'discharge',
      entityId: 'd-1',
      details: buildDischargeDiagnosisChangeAuditDetails({
        patientName: 'Paciente Uno',
        movementId: 'd-1',
        movementLabel: 'Alta',
        previousDiagnosis: 'Neumonia',
        nextDiagnosis: 'Neumonia resuelta',
      }),
      patientIdentifier: '11.111.111-1',
      recordDate: '2026-05-29',
      timestamp: '2026-05-29T12:00:00.000Z',
    };

    expect(buildClinicalAuditPresentation(log)).toMatchObject({
      title: 'Diagnóstico de egreso actualizado',
      narrative: 'Se actualizó el diagnóstico de egreso de Paciente Uno en Alta.',
      affectedSubject: 'Paciente Uno',
      impact: 'modificacion',
      clinicalArea: 'censo',
      importantChanges: [
        {
          fieldLabel: 'Diagnóstico',
          oldValue: 'Neumonia',
          newValue: 'Neumonia resuelta',
        },
      ],
    });
  });
});
