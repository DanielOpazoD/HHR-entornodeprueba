import { mapRayenBed } from './bedMapping';
import { buildSortableLocalTimestamp } from './localTimestamp';

export interface PatientBedMovement {
  changedAt: string;
  bedId: string;
  sourceBedLabel: string;
}

export interface PatientFlowTimeWindow {
  notBefore?: string;
  notAfter?: string;
}

interface PatientFlowRow {
  changedAt: string;
  bedId: string | null;
  sourceBedLabel: string;
}

interface PatientFlowParseResult {
  rows: PatientFlowRow[];
  hasMalformedMovementRow: boolean;
}

const toSortableLocalTimestamp = (date: string, time: string): string => {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date);
  const clock = /^(\d{2}):(\d{2}):(\d{2})$/.exec(time);
  if (!match || !clock) return '';
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const [hour, minute, second] = [Number(clock[1]), Number(clock[2]), Number(clock[3])];
  return buildSortableLocalTimestamp(year, month, day, hour, minute, second) ?? '';
};

const roomFromFlowLocation = (location: string): string | undefined =>
  /\bHabitaci[oó]n\s*0*[1-6]\b/i.exec(location)?.[0] ??
  /\bRecuperaci[oó]n\s*0*[1-4]\b/i.exec(location)?.[0] ??
  /\bNeo\s*0*[12]\b/i.exec(location)?.[0];

const parsePatientFlowRows = (text: string): PatientFlowParseResult => {
  const rows: PatientFlowRow[] = [];
  let hasMalformedMovementRow = false;

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    const row = /^(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})\s+(.+)$/.exec(line);
    if (!row) continue;

    const sourceLocation = row[3];
    const sourceBedLabel = sourceLocation.split(' ').at(-1) ?? '';
    const changedAt = toSortableLocalTimestamp(row[1], row[2]);
    if (!changedAt) {
      hasMalformedMovementRow = true;
      continue;
    }

    rows.push({
      changedAt,
      bedId: mapRayenBed({
        room: roomFromFlowLocation(sourceLocation),
        bed: sourceBedLabel,
      }).bedId,
      sourceBedLabel,
    });
  }

  return {
    rows: rows.sort((a, b) => a.changedAt.localeCompare(b.changedAt)),
    hasMalformedMovementRow,
  };
};

/**
 * Parses the official Ficha Médico "Flujo del Paciente" PDF after text extraction.
 * Rows are accepted only when their room/bed pair maps to a known HHR bed. Header identity is
 * exposed separately so the resolver can validate it transiently without persisting the report.
 */
export const parsePatientFlowMovements = (text: string): PatientBedMovement[] => {
  const movements = new Map<string, PatientBedMovement>();
  const parsed = parsePatientFlowRows(text);
  if (parsed.hasMalformedMovementRow) return [];

  for (const row of parsed.rows) {
    if (!row.bedId) continue;
    movements.set(`${row.changedAt}:${row.bedId}`, {
      changedAt: row.changedAt,
      bedId: row.bedId,
      sourceBedLabel: row.sourceBedLabel,
    });
  }

  return [...movements.values()].sort((a, b) => a.changedAt.localeCompare(b.changedAt));
};

export const latestPatientFlowMovement = (
  text: string,
  window: PatientFlowTimeWindow = {}
): PatientBedMovement | null => {
  const parsed = parsePatientFlowRows(text);
  if (parsed.hasMalformedMovementRow) return null;
  const rows = parsed.rows.filter(
    row =>
      (!window.notBefore || row.changedAt >= window.notBefore) &&
      (!window.notAfter || row.changedAt <= window.notAfter)
  );
  const latestTimestamp = rows.at(-1)?.changedAt;
  if (!latestTimestamp) return null;
  const latestRows = rows.filter(row => row.changedAt === latestTimestamp);
  const distinctBeds = new Set(latestRows.map(row => row.bedId));
  if (distinctBeds.size !== 1 || distinctBeds.has(null)) return null;
  const latest = latestRows[0];
  return { ...latest, bedId: latest.bedId as string };
};

/** RUN printed in the report header; returned normalized and used only for identity validation. */
export const patientRunFromFlowReport = (text: string): string => {
  const runs = new Set(
    [...String(text || '').matchAll(/\bRUN\s*:\s*([0-9.kK-]+)/gi)]
      .map(match => match[1].replace(/[^0-9kK]/g, '').toUpperCase())
      .filter(Boolean)
  );
  return runs.size === 1 ? [...runs][0] : '';
};
