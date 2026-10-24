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

  it.each([
    ['2026-10-25T04:30:00.000Z', '2026-10-24', '2026-10-23'],
    ['2027-01-01T05:30:00.000Z', '2027-01-01', '2026-12-31'],
    ['2028-03-01T17:00:00.000Z', '2028-03-01', '2028-02-29'],
  ])(
    'keeps Ayer one hospital calendar day before Hoy at %s in any device zone',
    (instant, today, yesterday) => {
      const options = buildPrescriptionUploadViewerDayOptions(new Date(instant));

      expect(options.map(option => option.isoDate)).toEqual([today, yesterday]);
    }
  );

  it('builds today and yesterday options from the current hospital day', () => {
    const options = buildPrescriptionUploadViewerDayOptions(new Date('2026-05-29T18:00:00.000Z'));

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
