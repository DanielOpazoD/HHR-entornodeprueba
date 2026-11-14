/**
 * The only door for times from Ficha Médico's clinical history JSON
 * (`/api/encounter/{encId}/getPatientEncounterHistoryReportServer/…`).
 *
 * That JSON writes its times without an offset, and each field keeps its own clock. Measured
 * 2026-11-02 against Eloísa's official history, which prints Rapa Nui time (52 stay-days, chance
 * 2.7 %), and recorded in docs/DOMAIN_RULES.md (TIME-02):
 * - mainland Chile: scale labels (100 % at -2 h), evolutions (66 %), medication administration
 *   records (56 %), diagnoses, general orders and shift changes;
 * - already Rapa Nui: vital signs (unchanged in 66 % of 2001);
 * - UTC: medication orders, as the extension's prescription center reads them.
 * HHR always reads the hospital clock, so each stamp is converted here by the clock of its field.
 */
import type { NursingActivitySource } from '../contracts/nursingShiftInference';
import { buildSortableLocalTimestamp } from './localTimestamp';
import { absoluteInstantInRapaNui, encounterWallClockInRapaNui } from './encounterWallClock';

export const FICHA_MEDICO_HISTORY_TIME_ZONE = 'America/Santiago';

/** A mainland wall clock without offset, as the history JSON writes it. */
const NAIVE_STAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

const mainland = new Intl.DateTimeFormat('en-CA', {
  timeZone: FICHA_MEDICO_HISTORY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const mainlandOffsetMs = (instant: number): number => {
  const parts = mainland.formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find(part => part.type === type)?.value ?? 0);
  const wall = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second')
  );
  return wall - Math.floor(instant / 1000) * 1000;
};

const fromMainlandWallClock = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number
): string | null => {
  if (!buildSortableLocalTimestamp(year, month, day, hour, minute, second)) return null;
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = wall - mainlandOffsetMs(wall);
  const instant = wall - mainlandOffsetMs(first);
  return absoluteInstantInRapaNui(new Date(instant).toISOString());
};

/**
 * Sortable Rapa Nui wall clock (`YYYY-MM-DDTHH:MM:SS`) of a history stamp, or null when it cannot
 * be read. A value that does carry an offset is converted from its own instant.
 */
export const fichaMedicoHistoryStampInRapaNui = (raw: string | undefined): string | null => {
  const value = (raw ?? '').trim();
  const naive = NAIVE_STAMP.exec(value);
  if (!naive) return absoluteInstantInRapaNui(value);
  const [, year, month, day, hour, minute, second] = naive;
  return fromMainlandWallClock(
    Number(year),
    Number(month),
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? 0)
  );
};

/** An ISO stamp without an offset, as the history JSON writes medication orders. */
const NAIVE_ISO_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

/**
 * Medication order's `PUBLISH_DATETIME` as an instant. The history JSON writes it in UTC without an
 * offset, so it gets its `Z`, the rule of the extension's prescription center
 * (`prescriptionPublishDateTime`). The panel shows an instant on the Rapa Nui clock and orders two
 * versions by their instants, which a converted wall clock cannot do in the repeated hour of a clock
 * change. Any other text is returned as Eloísa wrote it.
 */
export const fichaMedicoMedicationOrderStamp = (raw: string): string =>
  NAIVE_ISO_STAMP.test(raw) ? `${raw}Z` : raw;

/** Nursing activity read from the history JSON, converted by the clock of the field it came from. */
export const fichaMedicoActivityStampInRapaNui = (
  recordedAt: string | undefined,
  source: NursingActivitySource
): string | null =>
  source === 'vital-signs'
    ? encounterWallClockInRapaNui(recordedAt)
    : fichaMedicoHistoryStampInRapaNui(recordedAt);
