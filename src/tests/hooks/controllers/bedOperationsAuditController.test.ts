import { describe, expect, it } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import {
  resolveBlockedReasonUpdate,
  resolveMoveOrCopyOperation,
  resolveToggleBedTypeOperation,
  resolveToggleBlockedOperation,
  resolveToggleExtraBedOperation,
  toBedOperationAuditArgs,
} from '@/hooks/controllers/bedOperationsAuditController';

const createPatient = (bedId: string, patientName = 'Paciente', location = 'Sala A'): PatientData =>
  ({
    bedId,
    patientName,
    rut: '12.345.678-9',
    location,
    pathology: 'Neumonía en tratamiento',
    isBlocked: false,
  }) as PatientData;

const buildRecord = (): DailyRecord =>
  ({
    date: '2026-03-07',
    beds: {
      R1: createPatient('R1', 'Paciente 1', 'Sala 1'),
      R2: createPatient('R2', '', 'Sala 2'),
    },
    activeExtraBeds: ['E1'],
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '2026-03-07T00:00:00.000Z',
  }) as unknown as DailyRecord;

describe('bedOperationsAuditController', () => {
  it('resolves move/copy with patch and audit payloads', () => {
    const move = resolveMoveOrCopyOperation(buildRecord(), 'move', 'R1', 'R2');
    if (move.kind !== 'apply') {
      throw new Error('Expected apply result');
    }

    expect(move.patch).toEqual(
      expect.objectContaining({
        'beds.R2': expect.objectContaining({
          patientName: 'Paciente 1',
          bedId: 'R2',
          pathology: 'Neumonía en tratamiento',
        }),
      })
    );
    expect(move.audit.details).toEqual(
      expect.objectContaining({
        movementKind: 'move',
        sourceBed: 'R1',
        targetBed: 'R2',
        diagnosis: 'Neumonía en tratamiento',
        previousLocation: 'Sala 1',
        newLocation: 'Sala 2',
      })
    );
    expect(toBedOperationAuditArgs(move)).toEqual([
      'PATIENT_MODIFIED',
      'patient',
      'R2',
      expect.objectContaining({
        movementKind: 'move',
        sourceBed: 'R1',
        targetBed: 'R2',
      }),
      '12.345.678-9',
      '2026-03-07',
    ]);

    const noop = resolveMoveOrCopyOperation(buildRecord(), 'copy', 'R2', 'R1');
    expect(noop).toEqual({
      kind: 'noop',
      warning: 'Cannot copy empty patient from R2',
    });
  });

  it('resolves block, reason, extra bed and bed type operations', () => {
    const block = resolveToggleBlockedOperation(buildRecord(), 'R1', 'Aislamiento');
    expect(block.audit.action).toBe('BED_BLOCKED');
    expect(block.audit.details).toEqual({ bedId: 'R1', reason: 'Aislamiento' });

    const reasonNoop = resolveBlockedReasonUpdate(buildRecord(), 'R1', 'Nuevo motivo');
    expect(reasonNoop).toEqual({
      kind: 'noop',
      warning: 'Cannot update blocked reason for unblocked bed R1',
    });

    const extra = resolveToggleExtraBedOperation(buildRecord(), 'E2');
    expect(extra.patch).toEqual({ activeExtraBeds: ['E1', 'E2'] });
    expect(extra.audit.action).toBe('EXTRA_BED_TOGGLED');

    const bedType = resolveToggleBedTypeOperation(buildRecord(), 'R1');
    expect(bedType.kind).toBe('apply');
  });
});
