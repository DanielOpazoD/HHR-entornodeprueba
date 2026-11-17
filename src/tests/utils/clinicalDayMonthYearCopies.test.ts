// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatClinicalDayMonthYear } from '@/utils/clinicalTimeFormat';
import { formatRayenSyncTargetDate } from '@/features/rayen-import/components/rayenSyncPresentation';
import { formatReminderDateRange } from '@/shared/reminders/reminderPresentation';

/**
 * Seven screens and PDFs had their own copy of the DD-MM-YYYY formatter. They now call
 * `formatClinicalDayMonthYear`; each reference below is the removed copy, verbatim, so any
 * input that would have changed a label fails here.
 */
const splitCopy = (value: string): string => {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}-${month}-${year}` : value;
};

const removedCopies: Record<string, (value?: string | null) => string | null> = {
  // rayenSyncPresentation.formatRayenSyncTargetDate
  rayenSyncTargetDate: value => (value ? splitCopy(value) : 'hoy'),
  // rayenSyncBarViewModel.formatTargetDate
  rayenSyncBarTargetDate: value => (value ? splitCopy(value) : null),
  // PatientHospitalizationReportsDialog.formatDate
  hospitalizationReportDate: value => (value ? splitCopy(value) : ''),
  // scoresDetailTokens.formatIsoDay, prescriptionMonthlyPdfPrintDocument.formatIsoDayForDisplay,
  // reminderPresentation.formatReminderDate (the last two returned early on a missing part).
  isoDay: value => {
    const [year, month, day] = (value as string).split('-');
    if (!year || !month || !day) return value as string;
    return `${day}-${month}-${year}`;
  },
  // localSyncPresentation (census key label)
  censusKeyLabel: value => {
    const [year, month, day] = (value as string).split('-');
    return year && month && day ? `Censo del ${day}-${month}-${year}` : `Censo del ${value}`;
  },
};

const replacements: Record<string, (value?: string | null) => string | null> = {
  rayenSyncTargetDate: formatRayenSyncTargetDate,
  rayenSyncBarTargetDate: value => (value ? formatClinicalDayMonthYear(value) : null),
  hospitalizationReportDate: value => (value ? formatClinicalDayMonthYear(value) : ''),
  isoDay: value => formatClinicalDayMonthYear(value as string),
  censusKeyLabel: value => `Censo del ${formatClinicalDayMonthYear(value as string)}`,
};

const STRING_INPUTS = [
  '2026-01-01',
  '2026-01-31',
  '2026-02-28',
  '2028-02-29',
  '2026-04-30',
  '2026-12-31',
  '2027-01-01',
  '2026-1-5',
  '2026-01-05T10:30:00',
  '2026-01-05T10:30:00-03:00',
  '2026-01',
  '2026--05',
  '-01-05',
  '2026-01-',
  'a-b-c-d',
  'bad',
  ' 2026-01-05 ',
  '05-01-2026',
  '',
];

describe('DD-MM-YYYY: removed local copies match formatClinicalDayMonthYear', () => {
  for (const name of Object.keys(removedCopies)) {
    const inputs: Array<string | null | undefined> =
      name === 'isoDay' || name === 'censusKeyLabel'
        ? STRING_INPUTS
        : [...STRING_INPUTS, undefined, null];

    it.each(inputs.map(input => [input]))(`${name}(%j) keeps its label`, input => {
      expect(replacements[name](input)).toBe(removedCopies[name](input));
    });
  }

  it('keeps the public reminder range label', () => {
    expect(formatReminderDateRange('2026-12-31', '2027-01-01')).toBe('31-12-2026 a 01-01-2027');
    expect(formatReminderDateRange('bad', '')).toBe('bad a ');
  });
});
