/**
 * Timezone correction for the "Alta Administrativa" egreso report (gestión de camas / Hospitalizados
 * backend). That system prints egreso datetimes in **continental Chile time (America/Santiago)**,
 * which is exactly **2 hours ahead of Rapa Nui** (Pacific/Easter) — the two zones share the same DST
 * transitions, so the gap is a constant 2h year-round. Left uncorrected, a Rapa Nui egreso after
 * 22:00 local is printed on the *next* continental day, and its hour reads +2h off the island clock.
 *
 * `continentalReportToRapaNui` reads the report's `DD-MM-YYYY HH:MM` and returns the equivalent Rapa
 * Nui local day + time, so the discharge lands on the correct ISLAND day with the real local hour.
 */

export interface RapaNuiEgresoStamp {
  /** Rapa Nui calendar day (YYYY-MM-DD). */
  iso: string;
  /** Rapa Nui local time (HH:MM). */
  hhmm: string;
  /** Rapa Nui datetime as printed by the report (DD-MM-YYYY HH:MM). */
  text: string;
}

/** Continental Chile is 2h ahead of Rapa Nui (constant across DST). */
const CONTINENTAL_MINUS_RAPA_NUI_MS = 2 * 60 * 60 * 1000;

const pad2 = (value: number): string => String(value).padStart(2, '0');

export const continentalReportToRapaNui = (fechaEgreso: string): RapaNuiEgresoStamp | null => {
  const match = (fechaEgreso || '')
    .trim()
    .match(/^(\d{1,2})-(\d{1,2})-(\d{4})[ T]+(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const [, dd, mm, yyyy, hh, mi] = match;

  // Anchor the naive continental stamp in UTC to do pure arithmetic (no host-tz interference),
  // subtract the 2h offset to reach Rapa Nui local, then read the wall-clock fields back out.
  const rapaNui = new Date(
    Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi)) -
      CONTINENTAL_MINUS_RAPA_NUI_MS
  );

  const iso = `${rapaNui.getUTCFullYear()}-${pad2(rapaNui.getUTCMonth() + 1)}-${pad2(rapaNui.getUTCDate())}`;
  const hhmm = `${pad2(rapaNui.getUTCHours())}:${pad2(rapaNui.getUTCMinutes())}`;
  const text = `${pad2(rapaNui.getUTCDate())}-${pad2(rapaNui.getUTCMonth() + 1)}-${rapaNui.getUTCFullYear()} ${hhmm}`;
  return { iso, hhmm, text };
};
