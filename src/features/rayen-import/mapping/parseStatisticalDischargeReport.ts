import { isValidRut, normalizeRut } from '@/utils/rutUtils';
import { buildSortableLocalTimestamp } from './localTimestamp';

export interface StatisticalUnitTransfer {
  changedAt: string;
  unit: string;
}

export interface StatisticalDischargeEvidence {
  run: string;
  admissionAt: string;
  admissionUnit: string;
  dischargeAt: string;
  transfers: StatisticalUnitTransfer[];
}

const compactBoxedDigits = (value: string): string =>
  value.replace(/\b\d(?:\s+\d)+\b/g, digits => digits.replace(/\s+/g, ''));

const toTimestamp = (day: string, month: string, year: string, hour: string, minute: string) => {
  const shortYear = Number(year);
  const fullYear =
    year.length === 4 ? shortYear : shortYear >= 70 ? 1900 + shortYear : 2000 + shortYear;
  return (
    buildSortableLocalTimestamp(
      fullYear,
      Number(month),
      Number(day),
      Number(hour),
      Number(minute),
      0
    ) ?? ''
  );
};

const movementFromLine = (
  line: string,
  marker: RegExp
): { changedAt: string; unit: string } | null => {
  const normalized = line.replace(/\s+/g, ' ').trim();
  const header = marker.exec(normalized);
  if (!header) return null;
  const payload = normalized.slice(header[0].length).trim();
  const stamp =
    /^(\d\s*\d)\s*-\s*(\d\s*\d)\s+(\d\s*\d)\s*-\s*(\d\s*\d)\s*-\s*((?:\d\s*){2,4})\s+(.+)$/.exec(
      payload
    );
  if (!stamp) return null;
  const fields = stamp.slice(1, 6).map(value => value.replace(/\s+/g, ''));
  const changedAt = toTimestamp(fields[2], fields[3], fields[4], fields[0], fields[1]);
  const unit = stamp[6].replace(/\s+(?:\d\s*){3}$/, '').trim();
  return changedAt && unit ? { changedAt, unit } : null;
};

const reportRun = (text: string): string => {
  const lines = String(text || '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const marker = /\b1\.RUN:\s*(.*)$/i.exec(lines[index]);
    if (!marker) continue;
    const candidates = [marker[1], lines[index + 1] ?? '', lines[index + 2] ?? ''];
    for (const candidate of candidates) {
      const normalized = compactBoxedDigits(candidate);
      const match = /(?:^|\s)(\d{1,8})\s*-\s*([0-9K])\b/i.exec(normalized);
      if (!match) continue;
      const run = normalizeRut(`${match[1]}${match[2]}`);
      if (isValidRut(run)) return run;
    }
  }
  return '';
};

/** Parses only the temporal and unit evidence needed for historical census reconstruction. */
export const parseStatisticalDischargeEvidence = (
  text: string
): StatisticalDischargeEvidence | null => {
  const lines = String(text || '').split(/\r?\n/);
  const admission = lines
    .map(line => movementFromLine(line, /^24\s+INGRESO\b/i))
    .find((value): value is NonNullable<typeof value> => value !== null);
  const discharge = lines
    .map(line => movementFromLine(line, /^29\s+EGRESO\b/i))
    .find((value): value is NonNullable<typeof value> => value !== null);
  const run = reportRun(text);
  if (!run || !admission || !discharge || discharge.changedAt < admission.changedAt) return null;

  const transfers = lines
    .map(line => movementFromLine(line, /^(?:25\s+1er|26\s+2°|27\s+3er|28\s+4°)\s+TRASLADO\s*\*?/i))
    .filter((value): value is NonNullable<typeof value> => value !== null)
    .sort((a, b) => a.changedAt.localeCompare(b.changedAt));

  return {
    run,
    admissionAt: admission.changedAt,
    admissionUnit: admission.unit,
    dischargeAt: discharge.changedAt,
    transfers,
  };
};

export const confirmsHospitalizationAt = (
  evidence: StatisticalDischargeEvidence,
  cutoff: string
): boolean => evidence.admissionAt <= cutoff && cutoff < evidence.dischargeAt;

export const hasUnitTransferAtOrBefore = (
  evidence: StatisticalDischargeEvidence,
  cutoff: string
): boolean => evidence.transfers.some(transfer => transfer.changedAt <= cutoff);
