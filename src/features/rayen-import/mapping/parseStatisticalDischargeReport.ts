import { isValidRut, normalizeRut } from '@/utils/rutUtils';
import { buildSortableLocalTimestamp } from './localTimestamp';

import type {
  StatisticalDischargeEvidence,
  StatisticalUnitTransfer,
} from '@/types/domain/statisticalDischarge';
export type {
  StatisticalDischargeEvidence,
  StatisticalUnitTransfer,
} from '@/types/domain/statisticalDischarge';

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
  marker: RegExp,
  requireUnit = true
): { changedAt: string; unit: string } | null => {
  const normalized = line.replace(/\s+/g, ' ').trim();
  const header = marker.exec(normalized);
  if (!header) return null;
  const payload = normalized.slice(header[0].length).trim();
  const stamp =
    /^(\d\s*\d)\s*-\s*(\d\s*\d)\s+(\d\s*\d)\s*-\s*(\d\s*\d)\s*-\s*((?:\d\s*){2,4})(?:\s+(.+))?$/.exec(
      payload
    );
  if (!stamp) return null;
  const fields = stamp.slice(1, 6).map(value => value.replace(/\s+/g, ''));
  const changedAt = toTimestamp(fields[2], fields[3], fields[4], fields[0], fields[1]);
  const unit = (stamp[6] || '').replace(/\s+(?:\d\s*){3}$/, '').trim();
  return changedAt && (!requireUnit || unit) ? { changedAt, unit } : null;
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
    // The official form prints the discharge unit in a separate box, not on line 29.
    .map(line => movementFromLine(line, /^29\s+EGRESO\b/i, false))
    .find((value): value is NonNullable<typeof value> => value !== null);
  const run = reportRun(text);
  if (!run || !admission || !discharge || discharge.changedAt < admission.changedAt) return null;

  const transferMarker = /^(?:25\s+1er|26\s+2[°o]|27\s+3er|28\s+4[°o])\s+TRASLADO\s*\*?/i;
  const transfers: StatisticalUnitTransfer[] = [];
  let ordinal = 0;
  for (const line of lines) {
    const normalized = line.replace(/\s+/g, ' ').trim();
    const marker = transferMarker.exec(normalized);
    if (!marker) continue;
    const payload = normalized.slice(marker[0].length).trim();
    if (!payload.replace(/[-\s]/g, '')) continue;
    const nextOrdinal = Number(normalized.slice(0, 2)) - 24;
    if (nextOrdinal !== ordinal + 1) return null;
    ordinal = nextOrdinal;
    const transfer = movementFromLine(line, transferMarker);
    // An unreadable filled row is missing evidence, never proof of an unchanged unit.
    if (
      !transfer ||
      transfer.changedAt < admission.changedAt ||
      transfer.changedAt > discharge.changedAt
    )
      return null;
    if (transfers.length && transfer.changedAt < transfers[transfers.length - 1].changedAt)
      return null;
    const prior = transfers.find(item => item.changedAt === transfer.changedAt);
    if (prior && prior.unit !== transfer.unit) return null;
    if (!prior) transfers.push(transfer);
  }
  transfers.sort((a, b) => a.changedAt.localeCompare(b.changedAt));

  const condition = /(?:31\s+)?1\)\s*VIVO\s+2\)\s*FALLECIDO\s+([12])\b/i.exec(
    String(text || '').replace(/\s+/g, ' ')
  )?.[1];

  return {
    run,
    admissionAt: admission.changedAt,
    admissionUnit: admission.unit,
    dischargeAt: discharge.changedAt,
    transfers,
    ...(condition ? { isDead: condition === '2' } : {}),
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
