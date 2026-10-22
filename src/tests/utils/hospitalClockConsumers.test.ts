import { afterEach, describe, expect, it, vi } from 'vitest';

import { todayDateString } from '@/application/wound-care/woundCareUseCaseHelpers';
import { resolveMMRADDatePresetRange } from '@/components/modals/controllers/radiologyViewerModalController';
import { buildDeviceHistoryTimestamp } from '@/features/census/controllers/deviceHistoryController';
import {
  getCurrentDateValue,
  getCurrentTimeValue,
} from '@/features/clinical-documents/controllers/clinicalDocumentEpisodeController';
import { collectMonthlyPrescriptionExport } from '@/features/prescriptions/services/prescriptionMonthlyPdfService';
import { getCurrentShift } from '@/services/admin/attributionService';
import type { PatientData } from '@/services/contracts/patientServiceContracts';
import { getTodayFormatted } from '@/services/pdf/pdfBrowserUtils';
import { mapSourceToValue } from '@/services/utils/printMapper';
import { formatCensusIsoDate } from '@/shared/census/censusPresentation';
import type { PrescriptionRecord } from '@/types/prescriptionTypes';

// 23:30 on Oct 31 in Rapa Nui (UTC-5) is already Nov 1 both in UTC (04:30) and on the
// mainland devices the tests emulate (Santiago, 01:30). Every "now" must stay on Oct 31.
const LATE_EVENING = new Date('2026-11-01T04:30:00.000Z');

afterEach(() => {
  vi.useRealTimers();
});

describe('hospital clock consumers', () => {
  it('keeps "today" and "now" on the hospital wall clock after mainland and UTC midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(LATE_EVENING);

    expect(todayDateString()).toBe('2026-10-31');
    expect(getCurrentDateValue()).toBe('2026-10-31');
    expect(getCurrentTimeValue()).toBe('23:30');
    expect(getTodayFormatted()).toBe('31-10-2026');
    expect(getCurrentShift()).toBe('night');
    expect(
      mapSourceToValue(
        'today.date',
        {
          patient: {} as PatientData,
          survey: { diagnostico: '', peso: '', telefono: '', medicoTratante: '' },
          bedName: '',
          prevision: '',
          selectedExams: new Set(),
          manualValues: {},
        },
        'today'
      )
    ).toBe(formatCensusIsoDate('2026-10-31'));
  });

  it('stamps device events and search ranges with the hospital day', () => {
    expect(buildDeviceHistoryTimestamp({ now: LATE_EVENING })).toMatchObject({
      date: '2026-10-31',
      time: '23:30',
    });
    expect(resolveMMRADDatePresetRange('last-year', LATE_EVENING)).toEqual({
      from: '2025-10-31',
      to: '2026-10-31',
    });
  });

  it('files a late-evening prescription under the hospital month it was uploaded in', () => {
    const record = {
      id: 'rx-late',
      createdAt: LATE_EVENING.toISOString(),
    } as PrescriptionRecord;

    expect(collectMonthlyPrescriptionExport([record], '2026-10-15')).toEqual({
      records: [record],
      startIso: '2026-10-01',
      endIso: '2026-10-31',
    });
    expect(collectMonthlyPrescriptionExport([record], '2026-11-05').records).toEqual([]);
  });
});
