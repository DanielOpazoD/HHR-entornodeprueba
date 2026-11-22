import { CLINICAL_TIME_ZONE } from '@/utils/clinicalTimeZone';

/*
 * Braden and Downton applications keep the clock Eloísa printed, mainland Chile (TIME-02), because
 * their stored identity depends on it. Measured 2026-11-03 on 392 stored applications: 127 keep the
 * history JSON's `YYYY-MM-DDTHH:MM:SS[.ff]` without offset and 265 keep the scale report's
 * `DD-MM-YYYY H:MM:SS ±HH:MM` with its offset. Screens and cadences read them here, on the hospital
 * clock. The history JSON itself is read by rayen-import's fichaMedicoHistoryClock.
 */
const wallClock = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
const MAINLAND = wallClock('America/Santiago');
const RAPA_NUI = wallClock(CLINICAL_TIME_ZONE);

const format = (clock: Intl.DateTimeFormat, instant: number): string => {
  const part = Object.fromEntries(
    clock.formatToParts(instant).map(item => [item.type, item.value])
  );
  return `${part.year}-${part.month}-${part.day}T${part.hour}:${part.minute}:${part.second}`;
};

/** The instant of a mainland wall clock; the second pass settles a change of time. */
const mainlandInstant = (stamp: string): number => {
  const target = Date.parse(`${stamp}Z`);
  let instant = target;
  for (let pass = 0; pass < 2; pass += 1)
    instant += target - Date.parse(`${format(MAINLAND, instant)}Z`);
  return instant;
};

/** Rapa Nui wall clock (`YYYY-MM-DDTHH:MM:SS`) of a stored application, or null. */
export const evaluationScaleStampInRapaNui = (recordedAt: string | undefined): string | null => {
  const value = (recordedAt ?? '').trim();
  const [, repDay, repMonth, repYear, repHour, repMinSec, repSignHr, repTzMin] =
    /^(\d{2})-(\d{2})-(\d{4}) (\d{1,2}):(\d{2}:\d{2}) ?([+-]\d{2}):?(\d{2})$/.exec(value) ?? [];
  const [, naiveStamp] = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?$/.exec(value) ?? [];
  const instant =
    repDay && repMonth && repYear && repHour && repMinSec && repSignHr && repTzMin
      ? Date.parse(
          `${repYear}-${repMonth}-${repDay}T${repHour.padStart(2, '0')}:${repMinSec}${repSignHr}:${repTzMin}`
        )
      : naiveStamp
        ? mainlandInstant(naiveStamp)
        : NaN;
  return Number.isFinite(instant) ? format(RAPA_NUI, instant) : null;
};
