import { describe, expect, it } from 'vitest';

import {
  buildBedMovementAuditDetails,
  buildDischargeUndoAuditDetails,
  buildPatientMovementSummary,
} from '@/services/admin/auditClinicalEventCatalog';

describe('auditClinicalEventCatalog', () => {
  it('builds clinically meaningful bed movement details', () => {
    expect(
      buildBedMovementAuditDetails({
        movementKind: 'move',
        patientName: 'Paciente Uno',
        sourceBed: 'R1',
        targetBed: 'R2',
        previousLocation: 'R1',
        newLocation: 'R2',
      })
    ).toEqual({
      clinicalEvent: 'Movimiento de paciente entre camas',
      movementKind: 'move',
      patientName: 'Paciente Uno',
      sourceBed: 'R1',
      targetBed: 'R2',
      previousLocation: 'R1',
      newLocation: 'R2',
    });
  });

  it('builds clinically meaningful discharge undo details', () => {
    expect(
      buildDischargeUndoAuditDetails({
        dischargeId: 'd-1',
        patientName: 'Paciente Dos',
        restoredBed: 'R3',
      })
    ).toEqual({
      clinicalEvent: 'Reversión de alta',
      movementKind: 'undo_discharge',
      dischargeId: 'd-1',
      patientName: 'Paciente Dos',
      restoredBed: 'R3',
    });
  });

  it('summarizes patient movement details without exposing internal keys', () => {
    expect(
      buildPatientMovementSummary({
        patientName: 'Paciente Uno',
        movementKind: 'copy',
        sourceBed: 'R1',
        targetBed: 'R2',
      })
    ).toBe('Copia de paciente: Paciente Uno R1 → R2');

    expect(
      buildPatientMovementSummary({
        patientName: 'Paciente Dos',
        movementKind: 'undo_discharge',
        restoredBed: 'R3',
      })
    ).toBe('Reversión de alta: Paciente Dos vuelve a cama R3');
  });
});
