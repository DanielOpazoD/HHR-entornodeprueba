import { describe, expect, it } from 'vitest';
import {
  buildPrescriptionUploadViewerDayOptions,
  formatPrescriptionUploadViewerDate,
} from '@/features/prescriptions/components/prescriptionUploadReadonlyViewerSupport';

describe('prescriptionUploadReadonlyViewerSupport', () => {
  it('formats clinical day labels as day-month-year', () => {
    expect(formatPrescriptionUploadViewerDate('2026-05-09')).toBe('09-05-2026');
    expect(formatPrescriptionUploadViewerDate('2026-12-31')).toBe('31-12-2026');
  });

  it('builds today and yesterday options from the current local day', () => {
    const options = buildPrescriptionUploadViewerDayOptions(new Date(2026, 4, 29, 12));

    expect(options).toEqual([
      {
        key: 'today',
        label: 'Hoy',
        isoDate: '2026-05-29',
        displayDate: '29-05-2026',
      },
      {
        key: 'yesterday',
        label: 'Ayer',
        isoDate: '2026-05-28',
        displayDate: '28-05-2026',
      },
    ]);
  });
});
