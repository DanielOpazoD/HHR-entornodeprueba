import { describe, expect, it } from 'vitest';

import { buildDischargeDiagnosisChangeAuditDetails } from '@/services/admin/auditClinicalEventCatalog';
import { normalizeAuditTrailEvent } from '@/services/admin/auditTrail/auditTrailNormalize';
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

  it('shows the discharge diagnosis change as before and after in the audit trail', () => {
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

    expect(normalizeAuditTrailEvent(log)).toMatchObject({
      category: 'change',
      label: 'Diagnóstico de egreso',
      detail: 'Alta',
      patient: { name: 'Paciente Uno', document: '11.111.111-1' },
      changes: [{ field: 'Diagnóstico', before: 'Neumonia', after: 'Neumonia resuelta' }],
    });
  });
});
