import { buildSortableLocalTimestamp, parseStrictIsoInstant } from './localTimestamp';

/** Converts an absolute instant to the sortable wall clock used by Rayen's Rapa Nui reports. */
export const absoluteInstantInRapaNui = (raw: string | undefined): string | null => {
  const instant = parseStrictIsoInstant((raw ?? '').trim());
  if (!instant) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Easter',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find(part => part.type === type)?.value ?? 0);
  return buildSortableLocalTimestamp(
    value('year'),
    value('month'),
    value('day'),
    value('hour'),
    value('minute'),
    value('second')
  );
};

/** Accepts Rayen local datetimes as well as offset/UTC instants. */
export const encounterWallClockInRapaNui = (raw: string | undefined): string | null => {
  const value = (raw ?? '').trim();
  if (!value) return null;
  const localIso =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(value);
  if (localIso) {
    return buildSortableLocalTimestamp(
      Number(localIso[1]),
      Number(localIso[2]),
      Number(localIso[3]),
      Number(localIso[4] ?? 0),
      Number(localIso[5] ?? 0),
      Number(localIso[6] ?? 0)
    );
  }
  const localDmy =
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  if (localDmy) {
    return buildSortableLocalTimestamp(
      Number(localDmy[3]),
      Number(localDmy[2]),
      Number(localDmy[1]),
      Number(localDmy[4] ?? 0),
      Number(localDmy[5] ?? 0),
      Number(localDmy[6] ?? 0)
    );
  }
  return absoluteInstantInRapaNui(value);
};
