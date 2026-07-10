/**
 * Parser for the nursing "Instrumentos de evaluación" (risk scales) exposed by Ficha Médico's
 * encounter-form-entry endpoint:
 *
 *   GET {apiOrigin}/api/encounter/entrySummary/encounterFormEntry/{encId}/1/INSTRUMENTO/{practitionerId}
 *   headers: { Authorization: 'HSP <token>' }, credentials: 'omit'
 *
 * (`apiOrigin` = https://fichamedicoback.rayensalud.cl, `encId` = the clinical episode id already
 * used for devices, the trailing `INSTRUMENTO` filters the array to evaluation instruments only —
 * pass `0` there to also get VITAL_SIGNS forms. The token is the opaque HSP header captured by the
 * extension's inject script.)
 *
 * The response is an array of signed form entries; each risk scale has `formCodigo === 'INSTRUMENTO'`.
 * This pure function normalizes those raw forms into per-scale results carrying the individual item
 * answers, the total ("Puntaje") and the severity ("Nivel de Severidad"). Confirmed against real
 * Braden + Downton records.
 *
 * HISTORY & RECENCY. The endpoint returns the FULL history, so a scale can appear N times.
 * `encounterEventId` is monotonic (higher = more recently created), so within a day the *current*
 * value is the entry with the highest id. Ordering by the printed timestamps is NOT reliable:
 * `startDateTime`/`createDateTime` go stale on a "redo" (keep the original time) and their TZ offset
 * is inconsistent (server-continental -04:00 vs Rapa Nui -06:00 seen mixed on the same patient).
 *
 * CENSUS-DAY SELECTION. The sync must take the last score recorded ON THE CENSUS DAY being synced
 * (not the newest overall — a late sync of a past census must get that past day's score). Each scale
 * carries `recordedDate` (ISO, from the most recent per-field `createDatetime`, the most faithful
 * "when performed"); `evaluationScalesForCensusDay(scales, isoDay)` filters to that day then keeps the
 * latest per code by `encounterEventId`.
 *
 * TIMEZONE. `recordedDate` is the calendar day in RAPA NUI time (Pacific/Easter, -06/-05 with DST),
 * NOT the printed offset — the server mixes continental -04:00 and island -06:00 stamps, so a value
 * recorded just after local midnight would land on the wrong day if we trusted the printed date. We
 * resolve each stamp to an absolute instant (via its offset) and reformat it to the Pacific/Easter
 * day. The census day passed in must likewise be the Rapa Nui local ISO day — which HHR's daily-record
 * date already is (never build it via toISOString(); see the Rapa Nui timezone note).
 *
 * Scope: only the two nursing scales requested — Escala de riesgo UPP (Braden) and Escala de Riesgo
 * de caídas (J. H. DOWNTON). Other instruments are ignored. Both the total ("Puntaje") and severity
 * are the values HHR persists today; the per-item breakdown is kept here for future use.
 */

const RAPA_NUI_TZ = 'Pacific/Easter';

export type EvaluationScaleCode = 'BRADEN' | 'DOWNTON';

/** One answered sub-scale field (`sectionId === 0` in the raw form). */
export interface EvaluationScaleItem {
  /** Stable Rayen field code, e.g. "BRAD_Percepcion" / "DOWN_Medicamentos". */
  id: string;
  /** Human label, e.g. "Percepción sensorial". */
  label: string;
  /** Internal option code(s); comma-separated when the item is multi-select. */
  value: string;
  /** Selected option text(s), e.g. "No Limitado"; comma-separated when multi-select. */
  valueName: string;
}

/** A single recorded evaluation scale (one form entry, normalized). */
export interface EvaluationScale {
  code: EvaluationScaleCode;
  /** Instrument name as printed, e.g. "Escala de riesgo UPP (Braden)". */
  name: string;
  /** Monotonic event id; higher = more recent. Use to pick the current record within a day. */
  encounterEventId: number;
  /** ISO local day it was performed (YYYY-MM-DD) — the key for census-day selection. */
  recordedDate: string;
  /** When it was performed, verbatim as printed (local time; TZ offset is unreliable — see file note). */
  recordedAt: string;
  /** Nurse who recorded it (may be empty if absent). */
  author: string;
  /** Author role, e.g. "Enfermera(o)". */
  authorRole: string;
  /** The individual sub-scale answers. */
  items: EvaluationScaleItem[];
  /** Total numeric score ("Puntaje"); null when absent or non-numeric. */
  total: number | null;
  /** Severity result ("Nivel de Severidad"), e.g. "Riesgo bajo"; null when absent. */
  severity: string | null;
}

interface RawCampo {
  id?: unknown;
  label?: unknown;
  value?: unknown;
  valueName?: unknown;
  sectionId?: unknown;
  createDatetime?: unknown;
}

interface RawForm {
  formCodigo?: unknown;
  nameForm?: unknown;
  encounterEventId?: unknown;
  startDateTime?: unknown;
  createDateTime?: unknown;
  authorHealthCarePractitionerName?: unknown;
  authorHealthCarePractitionerRoleName?: unknown;
  metaCampList?: unknown;
}

const str = (value: unknown): string => (value == null ? '' : String(value)).trim();
const pad2 = (value: string | number): string => String(value).padStart(2, '0');

const rapaNuiDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: RAPA_NUI_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
/** Calendar day (YYYY-MM-DD) of an absolute instant in Rapa Nui time. en-CA formats as ISO. */
const rapaNuiDay = (epoch: number): string => rapaNuiDayFormatter.format(new Date(epoch));

interface ParsedStamp {
  /** Printed local day verbatim (offset-independent), fallback when the instant is unknown. */
  printedIso: string;
  /** Absolute instant, only when the stamp carries a TZ offset. */
  epoch: number | null;
}

/** Parse Rayen's "DD-MM-YYYY H:mm:ss [±HH:MM]". Offset present → resolvable to an instant. */
const parseRayenDateTime = (raw: string): ParsedStamp | null => {
  const m = raw.match(
    /^(\d{1,2})-(\d{1,2})-(\d{4})(?:[ T]+(\d{1,2}):(\d{2}):(\d{2})\s*([+-]\d{2}):?(\d{2})?)?/
  );
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss, offH, offM] = m;
  const printedIso = `${yyyy}-${pad2(mm)}-${pad2(dd)}`;
  if (offH == null) return { printedIso, epoch: null };
  const epoch = Date.parse(`${printedIso}T${pad2(hh)}:${mi}:${ss}${offH}:${offM ?? '00'}`);
  return { printedIso, epoch: Number.isNaN(epoch) ? null : epoch };
};

/**
 * The most faithful "when performed" for a form, as a Rapa Nui calendar day. Prefers stamps that
 * carry a TZ offset (resolvable to an absolute instant → correct island day even across midnight),
 * taking the latest; falls back to the latest printed date when no offset-bearing stamp exists.
 */
const effectiveWhen = (form: RawForm, campos: RawCampo[]): { iso: string; raw: string } => {
  const candidates = [
    ...campos.map(c => str(c.createDatetime)),
    str(form.createDateTime),
    str(form.startDateTime),
  ].filter(Boolean);

  let bestInstant: { iso: string; raw: string; epoch: number } | null = null;
  let bestPrinted: { iso: string; raw: string } | null = null;
  for (const raw of candidates) {
    const parsed = parseRayenDateTime(raw);
    if (!parsed) continue;
    if (parsed.epoch != null) {
      if (!bestInstant || parsed.epoch > bestInstant.epoch) {
        bestInstant = { iso: rapaNuiDay(parsed.epoch), raw, epoch: parsed.epoch };
      }
    } else if (!bestPrinted && !bestInstant) {
      bestPrinted = { iso: parsed.printedIso, raw };
    }
  }
  const best = bestInstant ?? bestPrinted;
  return best ? { iso: best.iso, raw: best.raw } : { iso: '', raw: str(form.startDateTime) };
};

const codeOf = (form: RawForm, campos: RawCampo[]): EvaluationScaleCode | null => {
  if (campos.some(c => str(c.id).toUpperCase().startsWith('BRAD_'))) return 'BRADEN';
  if (campos.some(c => str(c.id).toUpperCase().startsWith('DOWN_'))) return 'DOWNTON';
  const name = str(form.nameForm).toLowerCase();
  if (name.includes('braden')) return 'BRADEN';
  if (name.includes('downton')) return 'DOWNTON';
  return null;
};

/** Parse the raw endpoint payload into every recorded Braden/Downton scale (full history). */
export const parseEvaluationScales = (raw: unknown): EvaluationScale[] => {
  const forms: RawForm[] = Array.isArray(raw) ? (raw as RawForm[]) : [];
  const scales: EvaluationScale[] = [];

  for (const form of forms) {
    if (str(form.formCodigo).toUpperCase() !== 'INSTRUMENTO') continue;
    const campos: RawCampo[] = Array.isArray(form.metaCampList)
      ? (form.metaCampList as RawCampo[])
      : [];
    const code = codeOf(form, campos);
    if (!code) continue;

    const items: EvaluationScaleItem[] = [];
    let total: number | null = null;
    let severity: string | null = null;

    for (const campo of campos) {
      const id = str(campo.id);
      const idUpper = id.toUpperCase();
      if (idUpper.endsWith('_PUNTAJE')) {
        const n = Number(str(campo.value));
        total = Number.isFinite(n) ? n : null;
      } else if (idUpper.endsWith('_RESULTADOSCORE') || idUpper.endsWith('_RESULTADO')) {
        severity = str(campo.valueName) || null;
      } else if (Number(campo.sectionId) === 0) {
        items.push({
          id,
          label: str(campo.label),
          value: str(campo.value),
          valueName: str(campo.valueName),
        });
      }
    }

    const when = effectiveWhen(form, campos);
    scales.push({
      code,
      name: str(form.nameForm),
      encounterEventId: Number(form.encounterEventId) || 0,
      recordedDate: when.iso,
      recordedAt: when.raw,
      author: str(form.authorHealthCarePractitionerName),
      authorRole: str(form.authorHealthCarePractitionerRoleName),
      items,
      total,
      severity,
    });
  }

  return scales;
};

/** Pick, per code, the entry with the highest `encounterEventId`, in a stable Braden→Downton order. */
const pickLatestPerCode = (scales: EvaluationScale[]): EvaluationScale[] => {
  const latest = new Map<EvaluationScaleCode, EvaluationScale>();
  for (const scale of scales) {
    const current = latest.get(scale.code);
    if (!current || scale.encounterEventId > current.encounterEventId)
      latest.set(scale.code, scale);
  }
  return (['BRADEN', 'DOWNTON'] as EvaluationScaleCode[])
    .map(code => latest.get(code))
    .filter((scale): scale is EvaluationScale => scale != null);
};

/**
 * Current value of each scale across all history (highest `encounterEventId`). Day-agnostic — use
 * `evaluationScalesForCensusDay` for the sync, which scopes to the census day being consulted.
 */
export const latestEvaluationScales = (scales: EvaluationScale[]): EvaluationScale[] =>
  pickLatestPerCode(scales);

/**
 * The score the sync should take: for each scale, the last one recorded ON `censusIsoDay`
 * (YYYY-MM-DD, the census day being consulted, in Rapa Nui time — matches `recordedDate`). Scales not
 * recorded that day are omitted, so a day with no Braden/Downton yields nothing rather than an older value.
 */
export const evaluationScalesForCensusDay = (
  scales: EvaluationScale[],
  censusIsoDay: string
): EvaluationScale[] => pickLatestPerCode(scales.filter(s => s.recordedDate === censusIsoDay));
