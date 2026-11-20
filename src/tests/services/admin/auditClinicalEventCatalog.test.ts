// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  buildBedMovementAuditDetails,
  buildDischargeUndoAuditDetails,
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
});
