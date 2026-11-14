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
  it('offers both patients when each only carries a no-document marker', () => {
    const record = daily('SIN RUT');
    record.beds.R1.rut = 'S/N';
    expect(buildBedOptions(record).map(option => option.bedId)).toEqual(['R1', 'R2']);
    record.beds.R1.rut = 'SIN RUT';
    expect(buildBedOptions(record).map(option => option.bedId)).toEqual(['R1', 'R2']);
  });
  it('keeps separate bed fallbacks for missing documents', () => {
    const record = daily('');
    record.beds.R1.rut = '';
    expect(buildBedOptions(record).map(option => option.bedId)).toEqual(['R1', 'R2']);
  });
});

const sameBed = (rut: string, name = 'Bea Inventada', active = true): DailyRecord =>
  ({
    beds: active ? { R1: { patientName: 'Ana Inventada', rut } } : {},
    discharges: [{ bedId: 'R1', patientName: name, rut }],
    transfers: [{ bedId: 'R1', patientName: name, rut }],
  }) as unknown as DailyRecord;

describe('undocumented people sharing a bed', () => {
  it.each(['', 'SIN RUT', 'RN', 'S/N'])('keeps both people for %s', rut => {
    expect(buildBedOptions(sameBed(rut))).toEqual([
      { bedId: 'R1', patientName: 'Ana Inventada', patientRut: rut, patientStatus: 'active' },
      { bedId: 'R1', patientName: 'Bea Inventada', patientRut: rut, patientStatus: 'discharge' },
    ]);
  });
  it.each(['', 'SIN RUT', 'RN', '12.345.678-5', 'P123456785'])(
    'preserves the first state for the same person: %s',
    rut => {
      expect(buildBedOptions(sameBed(rut, '  ANA   INVENTÁDA  '))).toEqual([
        { bedId: 'R1', patientName: 'Ana Inventada', patientRut: rut, patientStatus: 'active' },
      ]);
      expect(buildBedOptions(sameBed(rut, 'Ana Inventada', false))).toEqual([
        { bedId: 'R1', patientName: 'Ana Inventada', patientRut: rut, patientStatus: 'discharge' },
      ]);
    }
  );
  it('deduplicates repeated movements while preserving different people', () => {
    const record = sameBed('');
    record.beds = {};
    record.discharges.push({ ...record.discharges[0] });
    record.transfers[0].patientName = 'Ana Inventada';
    expect(buildBedOptions(record).map(o => [o.patientName, o.patientStatus])).toEqual([
      ['Bea Inventada', 'discharge'],
      ['Ana Inventada', 'transfer'],
    ]);
  });
});
