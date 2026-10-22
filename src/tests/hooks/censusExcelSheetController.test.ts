import { describe, expect, it } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';
import { BEDS } from '@/constants/beds';
import {
  buildCensusWorkbookPlan,
  buildCensusWorkbookSheetDescriptors,
} from '@/hooks/controllers/censusExcelSheetController';
import { clinicalWallClockToDate } from '@/utils/clinicalWallClock';

const buildRecord = (date: string): DailyRecord =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '',
    nurses: [],
    activeExtraBeds: [],
  }) as unknown as DailyRecord;

describe('censusExcelSheetController', () => {
  it('builds one current-day snapshot using the current time in the sheet name', () => {
    const descriptors = buildCensusWorkbookSheetDescriptors({
      monthRecords: [buildRecord('2026-02-19'), buildRecord('2026-02-20')],
      currentDateString: '2026-02-20',
      // 14:25 in Rapa Nui is 16:25 on a mainland device: the sheet follows the hospital.
      now: clinicalWallClockToDate('2026-02-20', '14:25'),
    });

    const currentDayDescriptors = descriptors.filter(item => item.recordDate === '2026-02-20');
    expect(currentDayDescriptors).toHaveLength(1);
    expect(currentDayDescriptors[0]).toMatchObject({
      recordDate: '2026-02-20',
      sheetName: '20-02-2026 14-25',
      snapshotLabel: 'Hora actual 14:25',
    });
  });

  it('keeps previous days as regular daily sheets', () => {
    const descriptors = buildCensusWorkbookSheetDescriptors({
      monthRecords: [buildRecord('2026-02-19'), buildRecord('2026-02-20')],
      currentDateString: '2026-02-20',
      now: clinicalWallClockToDate('2026-02-20', '12:00'),
    });

    expect(descriptors.map(item => item.sheetName)).toEqual(['19-02-2026', '20-02-2026 12-00']);
  });

  it('creates only the current snapshot and excludes post-cutoff admissions', () => {
    const baseRecord = buildRecord('2026-01-23');
    baseRecord.beds[BEDS[0].id] = DataFactory.createMockPatient(BEDS[0].id, {
      patientName: 'Paciente 22:00',
      admissionDate: '2026-01-23',
      admissionTime: '22:00',
    });
    baseRecord.beds[BEDS[1].id] = DataFactory.createMockPatient(BEDS[1].id, {
      patientName: 'Paciente 01:00',
      admissionDate: '2026-01-24',
      admissionTime: '01:00',
    });

    const plan = buildCensusWorkbookPlan({
      monthRecords: [baseRecord],
      currentDateString: '2026-01-23',
      now: clinicalWallClockToDate('2026-01-23', '23:30'),
    });

    expect(plan.sheetDescriptors).toHaveLength(1);
    expect(plan.sheetDescriptors[0]?.snapshotLabel).toBe('Hora actual 23:30');
    expect(plan.sheetDescriptors[0]?.sheetName).not.toContain('23-59');

    const currentRecord = plan.records[plan.sheetDescriptors[0]?.recordLookupIndex ?? -1];
    expect(currentRecord.beds[BEDS[0].id]?.patientName).toBe('Paciente 22:00');
    expect(currentRecord.beds[BEDS[1].id]).toBeUndefined();
  });
});
