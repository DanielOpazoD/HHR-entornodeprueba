import { describe, expect, it, vi } from 'vitest';
import { buildBedOptions } from '@/features/prescriptions/components/prescriptionReassignDialogSupport';
import type { DailyRecord } from '@/types/domain/dailyRecord';

vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordFromFirestore: vi.fn(),
}));

const daily = (secondDocument: string): DailyRecord =>
  ({
    beds: {
      R1: { patientName: 'Sol Sintetico', rut: '12.345.678-5' },
      R2: { patientName: 'Luna Sintetica', rut: secondDocument },
    },
    discharges: [],
    transfers: [],
  }) as unknown as DailyRecord;

describe('buildBedOptions document identity', () => {
  it('offers both passport and RUT patients even when their digits match', () => {
    expect(buildBedOptions(daily('P123456785')).map(option => option.bedId)).toEqual(['R1', 'R2']);
  });
  it('offers the same RUT only once despite formatting differences', () => {
    expect(buildBedOptions(daily('123456785')).map(option => option.bedId)).toEqual(['R1']);
  });
  it('keeps separate bed fallbacks for missing documents', () => {
    const record = daily('');
    record.beds.R1.rut = '';
    expect(buildBedOptions(record).map(option => option.bedId)).toEqual(['R1', 'R2']);
  });
});
