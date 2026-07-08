import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMovements } from '@/hooks/useMovements';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { TransferData } from '@/types/domain/movements';
import type { PatientData } from '@/types/domain/patient';
import { restoreConsole, suppressConsole } from '@/tests/utils/consoleTestUtils';
import {
  getActiveDischarges,
  getActiveTransfers,
  isMovementDeleted,
} from '@/application/census/movementTombstonePolicy';

describe('useMovements', () => {
  type BedPatient = DailyRecord['beds'][string];
  type ClinicalCrib = NonNullable<BedPatient['clinicalCrib']>;

  let mockRecord: DailyRecord;
  const saveAndUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRecord = DataFactory.createMockDailyRecord('2025-01-01');
  });

  describe('Discharge Operations', () => {
    it('should add a basic discharge for mother', () => {
      const bedId = 'bed-1-utp-1';
      mockRecord.beds[bedId] = DataFactory.createMockPatient(bedId, {
        patientName: 'Jane Doe',
        rut: '12345678-9',
      });

      const { result } = renderHook(() => useMovements(mockRecord, saveAndUpdate));

      act(() => {
        result.current.addDischarge(bedId, 'Vivo', undefined, 'Domicilio', '', '12:00', 'mother');
      });

      expect(saveAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          discharges: expect.arrayContaining([
            expect.objectContaining({
              patientName: 'Jane Doe',
              status: 'Vivo',
              bedId: bedId,
            }),
          ]),
        })
      );

      // Should have cleared the bed
      const updatedRecord = saveAndUpdate.mock.calls[0][0];
      expect(updatedRecord.beds[bedId].patientName).toBe('');
    });

    it('should add discharge for baby only', () => {
      const bedId = 'bed-1-utp-1';
      mockRecord.beds[bedId] = DataFactory.createMockPatient(bedId, {
        patientName: 'Jane Doe',
        clinicalCrib: {
          patientName: 'Baby Doe',
          rut: 'baby-rut',
          age: '1d',
          pathology: 'Healthy',
        } as unknown as ClinicalCrib,
      });

      const { result } = renderHook(() => useMovements(mockRecord, saveAndUpdate));

      act(() => {
        result.current.addDischarge(bedId, 'Vivo', 'Vivo', 'Domicilio', '', '12:00', 'baby');
      });

      const updatedRecord = saveAndUpdate.mock.calls[0][0];
      expect(updatedRecord.discharges).toHaveLength(1);
      expect(updatedRecord.discharges[0].patientName).toBe('Baby Doe');
      expect(updatedRecord.beds[bedId].patientName).toBe('Jane Doe');
      expect(updatedRecord.beds[bedId].clinicalCrib).toBeUndefined();
    });

    it('should add both discharges', () => {
      const bedId = 'bed-1-utp-1';
      mockRecord.beds[bedId] = DataFactory.createMockPatient(bedId, {
        patientName: 'Jane Doe',
        clinicalCrib: {
          patientName: 'Baby Doe',
          rut: 'baby-rut',
          age: '1d',
          pathology: 'Healthy',
        } as unknown as ClinicalCrib,
      });

      const { result } = renderHook(() => useMovements(mockRecord, saveAndUpdate));

      act(() => {
        result.current.addDischarge(bedId, 'Vivo', 'Vivo', 'Domicilio', '', '12:00', 'both');
      });

      const updatedRecord = saveAndUpdate.mock.calls[0][0];
      expect(updatedRecord.discharges).toHaveLength(2);
      expect(updatedRecord.beds[bedId].patientName).toBe('');
    });

    it('should promote baby to main bed when mother is discharged and baby remains', () => {
      const bedId = 'bed-1-utp-1';
      mockRecord.beds[bedId] = DataFactory.createMockPatient(bedId, {
        patientName: 'Jane Doe',
        location: 'Room 101',
        clinicalCrib: {
          patientName: 'Baby Doe',
          rut: 'baby-rut',
          age: '1d',
          pathology: 'Healthy',
        } as unknown as ClinicalCrib,
      });

      const { result } = renderHook(() => useMovements(mockRecord, saveAndUpdate));

      act(() => {
        result.current.addDischarge(bedId, 'Vivo', undefined, 'Domicilio', '', '12:00', 'mother');
      });

      const updatedRecord = saveAndUpdate.mock.calls[0][0];
      expect(updatedRecord.beds[bedId].patientName).toBe('Baby Doe');
      expect(updatedRecord.beds[bedId].bedMode).toBe('Cuna');
      expect(updatedRecord.beds[bedId].clinicalCrib).toBeUndefined();
      expect(updatedRecord.beds[bedId].location).toBe('Room 101');
    });

    it('should handle discharge type "Otra" with description', () => {
      const bedId = 'bed-1-utp-1';
      mockRecord.beds[bedId] = DataFactory.createMockPatient(bedId, { patientName: 'Jane' });

      const { result } = renderHook(() => useMovements(mockRecord, saveAndUpdate));

      act(() => {
        result.current.addDischarge(
          bedId,
          'Vivo',
          undefined,
          'Otra',
          'Custom Reason',
          '12:00',
          'mother'
        );
      });

      const updatedRecord = saveAndUpdate.mock.calls[0][0];
      expect(updatedRecord.discharges[0].dischargeType).toBe('Otra');
      expect(updatedRecord.discharges[0].dischargeTypeOther).toBe('Custom Reason');
    });

    it('should update discharge details', () => {
      const discharge = DataFactory.createMockDischarge({ id: 'd1', status: 'Vivo' });
      mockRecord.discharges = [discharge];

      const { result } = renderHook(() => useMovements(mockRecord, saveAndUpdate));

      act(() => {
        result.current.updateDischarge('d1', 'Fallecido', undefined, '', '15:00');
      });

      expect(saveAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          discharges: [expect.objectContaining({ id: 'd1', status: 'Fallecido', time: '15:00' })],
        })
      );
    });

    it('should delete a discharge', () => {
      mockRecord.discharges = [DataFactory.createMockDischarge({ id: 'd1' })];

      const { result } = renderHook(() => useMovements(mockRecord, saveAndUpdate));

      act(() => {
        result.current.deleteDischarge('d1');
      });

      const updatedRecord = saveAndUpdate.mock.calls[0][0];
      expect(getActiveDischarges(updatedRecord.discharges)).toHaveLength(0);
      expect(updatedRecord.discharges[0]).toEqual(
        expect.objectContaining({
          id: 'd1',
          deletedAt: expect.any(String),
          deletedReason: 'manual_delete',
        })
      );
      expect(isMovementDeleted(updatedRecord.discharges[0])).toBe(true);
    });
  });

  describe('Undo Operations', () => {
    it('should undo mother discharge', () => {
      const bedId = 'bed-1-utp-1';
      const originalData = { patientName: 'Jane Doe', rut: '123' };
      const discharge = DataFactory.createMockDischarge({
        id: 'd1',
        bedId,
        isNested: false,
        originalData: originalData as unknown as PatientData,
      });
      mockRecord.discharges = [discharge];
      mockRecord.beds[bedId] = createEmptyPatient(bedId);

      const { result } = renderHook(() => useMovements(mockRecord, saveAndUpdate));

      act(() => {
        result.current.undoDischarge('d1');
      });

      const updatedRecord = saveAndUpdate.mock.calls[0][0];
      expect(updatedRecord.beds[bedId].patientName).toBe('Jane Doe');
      expect(getActiveDischarges(updatedRecord.discharges)).toHaveLength(0);
      expect(updatedRecord.discharges[0]).toEqual(
        expect.objectContaining({ id: 'd1', deletedAt: expect.any(String) })
      );
    });

    it('should undo baby (nested) discharge', () => {
      const bedId = 'bed-1-utp-1';
      const babyData = { patientName: 'Baby Doe', rut: 'baby-123' };
      const discharge = DataFactory.createMockDischarge({
        id: 'd-baby',
        bedId,
        isNested: true,
        originalData: babyData as unknown as PatientData,
      });
      mockRecord.discharges = [discharge];
      mockRecord.beds[bedId] = DataFactory.createMockPatient(bedId, { patientName: 'Mother Doe' });

      const { result } = renderHook(() => useMovements(mockRecord, saveAndUpdate));

      act(() => {
        result.current.undoDischarge('d-baby');
      });

      const updatedRecord = saveAndUpdate.mock.calls[0][0];
      expect(updatedRecord.beds[bedId].clinicalCrib?.patientName).toBe('Baby Doe');
      expect(getActiveDischarges(updatedRecord.discharges)).toHaveLength(0);
      expect(updatedRecord.discharges[0]).toEqual(
        expect.objectContaining({ id: 'd-baby', deletedAt: expect.any(String) })
      );
    });

    it('should prevent undo if bed is occupied', () => {
      const bedId = 'bed-1-utp-1';
      const discharge = DataFactory.createMockDischarge({
        id: 'd1',
        bedId,
        isNested: false,
        originalData: { patientName: 'Jane' } as unknown as PatientData,
      });
      mockRecord.discharges = [discharge];
      mockRecord.beds[bedId] = DataFactory.createMockPatient(bedId, { patientName: 'Occupant' });

      vi.spyOn(window, 'alert').mockImplementation(() => {});

      const { result } = renderHook(() => useMovements(mockRecord, saveAndUpdate));

      act(() => {
        result.current.undoDischarge('d1');
      });

      expect(saveAndUpdate).not.toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalled();
    });
  });

  describe('Transfer Operations', () => {
    it('should add a transfer', () => {
      const bedId = 'bed-1-utp-1';
      mockRecord.beds[bedId] = DataFactory.createMockPatient(bedId, {
        patientName: 'Steve Smith',
      });

      const { result } = renderHook(() => useMovements(mockRecord, saveAndUpdate));

      act(() => {
        result.current.addTransfer(bedId, 'Ambulancia', 'Hosp A', '', 'Escort', '10:00');
      });

      expect(saveAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          transfers: expect.arrayContaining([
            expect.objectContaining({
              patientName: 'Steve Smith',
              evacuationMethod: 'Ambulancia',
              receivingCenter: 'Hosp A',
            }),
          ]),
        })
      );
      expect(saveAndUpdate.mock.calls[0][0].beds[bedId].patientName).toBe('');
    });

    it('should include baby in transfer if present', () => {
      const bedId = 'bed-1-utp-1';
      mockRecord.beds[bedId] = DataFactory.createMockPatient(bedId, {
        patientName: 'Mother',
        clinicalCrib: { patientName: 'Baby' } as unknown as ClinicalCrib,
      });

      const { result } = renderHook(() => useMovements(mockRecord, saveAndUpdate));

      act(() => {
        result.current.addTransfer(bedId, 'Aereo', 'Hosp B', '');
      });

      const updatedRecord = saveAndUpdate.mock.calls[0][0];
      expect(updatedRecord.transfers).toHaveLength(2);
      expect(updatedRecord.transfers.some((t: TransferData) => t.patientName === 'Baby')).toBe(
        true
      );
    });

    it('should update and delete transfers', () => {
      const transferId = 't1';
      mockRecord.transfers = [
        DataFactory.createMockTransfer({ id: transferId, receivingCenter: 'Center A' }),
      ];

      const { result } = renderHook(() => useMovements(mockRecord, saveAndUpdate));

      act(() => {
        result.current.updateTransfer(transferId, { receivingCenter: 'Center B' });
      });

      expect(saveAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          transfers: [expect.objectContaining({ id: transferId, receivingCenter: 'Center B' })],
        })
      );

      act(() => {
        result.current.deleteTransfer(transferId);
      });

      const deletedRecord = saveAndUpdate.mock.calls.at(-1)?.[0];
      expect(getActiveTransfers(deletedRecord.transfers)).toHaveLength(0);
      expect(deletedRecord.transfers[0]).toEqual(
        expect.objectContaining({
          id: transferId,
          deletedAt: expect.any(String),
          deletedReason: 'manual_delete',
        })
      );
      expect(isMovementDeleted(deletedRecord.transfers[0])).toBe(true);
    });

    it('should undo transfer', () => {
      const bedId = 'bed-1-utp-1';
      const transfer = DataFactory.createMockTransfer({
        id: 't-undo',
        bedId,
        originalData: { patientName: 'Transferred Patient' } as unknown as PatientData,
      });
      mockRecord.transfers = [transfer];
      mockRecord.beds[bedId] = createEmptyPatient(bedId);

      const { result } = renderHook(() => useMovements(mockRecord, saveAndUpdate));

      act(() => {
        result.current.undoTransfer('t-undo');
      });

      const updatedRecord = saveAndUpdate.mock.calls[0][0];
      expect(updatedRecord.beds[bedId].patientName).toBe('Transferred Patient');
      expect(getActiveTransfers(updatedRecord.transfers)).toHaveLength(0);
      expect(updatedRecord.transfers[0]).toEqual(
        expect.objectContaining({ id: 't-undo', deletedAt: expect.any(String) })
      );
    });
  });

  describe('Null/Empty State Handling', () => {
    it('should do nothing if record is null', () => {
      const { result } = renderHook(() => useMovements(null, saveAndUpdate));

      act(() => {
        result.current.addDischarge('bed-1', 'Vivo');
        result.current.updateDischarge('d1', 'Vivo');
        result.current.undoDischarge('d1');
        result.current.addTransfer('bed-1', 'A', 'B', '');
        result.current.updateTransfer('t1', {});
        result.current.undoTransfer('t1');
      });

      expect(saveAndUpdate).not.toHaveBeenCalled();
    });

    it('should do nothing if bed is empty in addDischarge/addTransfer', () => {
      const consoleSpies = suppressConsole(['warn']);
      const bedId = 'bed-1-utp-1';
      mockRecord.beds[bedId] = createEmptyPatient(bedId);

      try {
        const { result } = renderHook(() => useMovements(mockRecord, saveAndUpdate));

        act(() => {
          result.current.addDischarge(bedId, 'Vivo');
          result.current.addTransfer(bedId, 'A', 'B', '');
        });

        expect(saveAndUpdate).not.toHaveBeenCalled();
      } finally {
        restoreConsole(consoleSpies);
      }
    });
  });
});

function createEmptyPatient(bedId: string) {
  return {
    bedId,
    patientName: '',
    rut: '',
    age: '',
    pathology: '',
    specialty: '',
    status: '',
    nursingCare: '',
    clinicalCrib: undefined,
    location: 'Interior',
  } as unknown as DailyRecord['beds'][string];
}
