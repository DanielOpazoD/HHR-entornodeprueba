/**
 * Parser for the nursing risk scales (Braden UPP + Downton falls) as exposed by Ficha Médico's
 * clinical-history report ("panel de historial"):
 *
 *   GET {apiOrigin}/api/encounter/{encId}/getPatientEncounterHistoryReportServer/false/0/0/-14
 *   headers: { Authorization: 'HSP <token>' }, credentials: 'omit'
 *
 * WHY THIS SOURCE (not encounterFormEntry). The encounter-form-entry endpoint we used before returns
 * a form's `startDateTime`, which goes STALE on a redo (keeps the original day) and — worse — misses
 * same-day re-applications entirely: a patient re-scored today would still show only yesterday's
 * forms, all stamped yesterday. The history report instead lists every clinical intervention with its
 * real `publishDatetime`, so we can faithfully pick the last score APPLIED ON the census day being
 * synced (including a late sync of a PAST census, and multiple re-applications the same day).
 *
 * SHAPE. The extension pre-slims the report to the events that carry an `evaluationInstrumentsResume`
 * (Braden/Downton), each event being `{ publishDatetime, evaluationInstrumentsResume: campo[] }` with
 * campos `{ FORM_NAME, LABEL, VALUE, ARCHIVED, MCAM_ID, PUBLISH_DATE_HCP_NAME, PRACTITIONER_ROLE }`.
 * One nurse assessment = one event = one form; we still group by form name defensively in case an
 * event bundles both scales. Confirmed against real Braden + Downton records (encId 141121).
 *
 * TIMEZONE. `publishDatetime` is a naive local wall-clock stamp ("2026-07-11T12:35:29.97", no offset)
 * — it matches the time the nurse sees in the history panel, i.e. Rapa Nui local time (its clock lines
 * up with the offset-bearing `-06:00` stamp of the same event in encounterFormEntry). So the calendar
 * day is simply its first 10 chars; we deliberately do NOT `Date.parse()` it (that would reinterpret
 * a naive string as the runtime's zone — UTC on CI — and shift the day). The census day passed to the
 * selectors must likewise be the Rapa Nui local ISO day, which HHR's daily-record date already is.
 *
 * RECENCY. Each scale carries `encounterEventId` derived from `publishDatetime` as a monotonic
 * YYYYMMDDHHMMSS integer (higher = later), so `evaluationScalesForCensusDay` keeps the last one of the
 * day per code. Output is the shared `EvaluationScale` shape, so it feeds `mergeReportScales` and the
 * census scores view unchanged.
 */

import type {
  EvaluationScale,
  EvaluationScaleCode,
  EvaluationScaleItem,
} from './parseEvaluationScales';

interface RawResumeCampo {
  FORM_NAME?: unknown;
  LABEL?: unknown;
  VALUE?: unknown;
  ARCHIVED?: unknown;
  MCAM_ID?: unknown;
  PUBLISH_DATE_HCP_NAME?: unknown;
  PRACTITIONER_ROLE?: unknown;
}

interface RawHistoryEvent {
  publishDatetime?: unknown;
  evaluationInstrumentsResume?: unknown;
}

const str = (value: unknown): string => (value == null ? '' : String(value)).trim();

const codeOfForm = (formName: string): EvaluationScaleCode | null => {
  const name = formName.toLowerCase();
  if (name.includes('braden')) return 'BRADEN';
  if (name.includes('downton')) return 'DOWNTON';
  return null;
};

/** `publishDatetime` → { iso day, monotonic key }. Null when it isn't a datable stamp. */
const parsePublishDatetime = (raw: string): { iso: string; key: number } | null => {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, hh = '00', mi = '00', ss = '00'] = m;
  return { iso: `${y}-${mo}-${d}`, key: Number(`${y}${mo}${d}${hh}${mi}${ss}`) };
};

const isPuntaje = (label: string): boolean => label.trim().toLowerCase().startsWith('puntaje');
const isSeveridad = (label: string): boolean => label.toLowerCase().includes('severidad');

/** A parsed scale plus whether its source record was archived (superseded) in Ficha Médico. */
type ParsedScale = EvaluationScale & { archived: boolean };

/**
 * Resolve the effective scales from every parsed instance:
 *  - collapse the report's verbatim duplicates (same code + timestamp; the Jasper report repeats one
 *    event up to 3×), preferring a non-archived copy on a tie;
 *  - per scale code AND day, drop ARCHIVED (superseded) instances ONLY when a non-archived one exists
 *    that same day. If the day's only record is archived, KEEP it — the assessment WAS done and that
 *    archived score is the sole evidence of it (Rayen shows it tagged "archivado"). Rule confirmed by
 *    Daniel: prefer the live score of the day, fall back to the archived one when it stands alone.
 */
const resolveEffectiveScales = (parsed: ParsedScale[]): EvaluationScale[] => {
  const byKey = new Map<string, ParsedScale>();
  for (const scale of parsed) {
    const key = `${scale.code} ${scale.encounterEventId}`;
    const current = byKey.get(key);
    if (!current || (current.archived && !scale.archived)) byKey.set(key, scale);
  }

  const daysWithLiveScore = new Set<string>();
  for (const scale of byKey.values()) {
    if (!scale.archived) daysWithLiveScore.add(`${scale.code} ${scale.recordedDate}`);
  }

  const result: EvaluationScale[] = [];
  for (const scale of byKey.values()) {
    if (scale.archived && daysWithLiveScore.has(`${scale.code} ${scale.recordedDate}`)) continue;
    // Keep the `archived` flag on the survivors: an archived-only-of-its-day record must still lose to
    // a LIVE record of the same day found in the OTHER source — cross-source resolution needs the flag.
    result.push(scale);
  }
  return result;
};

/**
 * Parse the slimmed history events into every recorded Braden/Downton scale (one per event/form),
 * then resolve the effective ones (see `resolveEffectiveScales`: dedupe + archived-fallback). The
 * result is day-agnostic history — use `evaluationScalesForCensusDay` / `evaluationScalesAsOf` (from
 * `parseEvaluationScales`) to scope the sync to the census day being consulted.
 */
export const parseHistoryScales = (rawEvents: unknown): EvaluationScale[] => {
  const events: RawHistoryEvent[] = Array.isArray(rawEvents)
    ? (rawEvents as RawHistoryEvent[])
    : [];
  const parsed: ParsedScale[] = [];

  for (const event of events) {
    const stamp = parsePublishDatetime(str(event.publishDatetime));
    if (!stamp) continue;

    const campos: RawResumeCampo[] = Array.isArray(event.evaluationInstrumentsResume)
      ? (event.evaluationInstrumentsResume as RawResumeCampo[])
      : [];

    // Group this event's campos by form name (defensive: an event may bundle both scales). Archived
    // campos are KEPT here — an archived record still proves the assessment was done; it is only
    // discarded later if a non-archived version exists the SAME day (see resolveEffectiveScales).
    const byForm = new Map<string, RawResumeCampo[]>();
    for (const campo of campos) {
      if (!campo) continue;
      const formName = str(campo.FORM_NAME);
      if (!codeOfForm(formName)) continue;
      const bucket = byForm.get(formName);
      if (bucket) bucket.push(campo);
      else byForm.set(formName, [campo]);
    }

    for (const [formName, formCampos] of byForm) {
      const code = codeOfForm(formName);
      if (!code || formCampos.length === 0) continue;

      const items: EvaluationScaleItem[] = [];
      let total: number | null = null;
      let severity: string | null = null;

      for (const campo of formCampos) {
        const label = str(campo.LABEL);
        const value = str(campo.VALUE);
        if (isPuntaje(label)) {
          const n = Number(value);
          total = value !== '' && Number.isFinite(n) ? n : null;
        } else if (isSeveridad(label)) {
          severity = value || null;
        } else {
          items.push({ id: str(campo.MCAM_ID) || label, label, value: '', valueName: value });
        }
      }

      const first = formCampos[0];
      parsed.push({
        code,
        name: formName,
        encounterEventId: stamp.key,
        recordedDate: stamp.iso,
        recordedAt: str(event.publishDatetime),
        author: str(first.PUBLISH_DATE_HCP_NAME),
        authorRole: str(first.PRACTITIONER_ROLE),
        items,
        total,
        severity,
        archived: formCampos.length > 0 && formCampos.every(campo => campo.ARCHIVED === true),
      });
    }
  }

  return resolveEffectiveScales(parsed);
};
