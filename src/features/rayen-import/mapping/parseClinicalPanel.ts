/**
 * Parser for the per-patient CLINICAL PANEL (evoluciones + indicaciones + cuidados) from Ficha
 * Médico's history and current care-plan events (relayed slimmed by the extension).
 *
 * Pure: raw events in → ready-to-render structures out:
 *   - `evolutions` → medical evolutions (`evolutionResume`) + nursing shift-change notes
 *     (`shiftChangeResume`), newest first. Each carries the PERSON's name (composed from the
 *     HCP_* name parts — `HCPR_NAME` is the ROLE, not the person) and a `profession` bucket
 *     (medical / nursing / other) so the drawer can split them into sub-tabs.
 *   - `indicationDays` → the classic daily indication sheet: one group per calendar day (newest
 *     first) listing that day's indications in clinical order (régimen → reposo → fármacos →
 *     libres), with suspended/archived ones split out so the drawer can tuck them behind a
 *     discreet toggle.
 *   - `careDays` → nursing care actions with performed, pending, omitted, suspended and
 *     outside-planning states.
 *
 * Within a day, pharma/free entries are deduped by their stable id (MRE_ID / AMRE_ID) keeping the
 * LATEST publication (its flags reflect the current state); diet/rest have no stable id, so they
 * dedupe by their text. Nothing here is persisted: the panel is a live, on-demand view.
 */

import type {
  RayenClinicalPanelCarePlan,
  RayenClinicalPanelEvent,
} from '../bridge/clinicalPanelBridge';
import { parseClinicalCareDays, type ClinicalPanelCareDay } from './parseClinicalCarePlan';
import { toTitleCaseName } from './rayenToPatientData';

export type ClinicalPanelEntryKind =
  | 'evolution'
  | 'shift-change'
  | 'pharma'
  | 'free-indication'
  | 'diet'
  | 'rest';

/** Bucket for the Evoluciones sub-tabs, derived from the practitioner ROLE. */
export type EvolutionProfession = 'medical' | 'nursing' | 'other';

export interface ClinicalPanelEntry {
  /** Stable within one parse — source id when the row has one, positional otherwise. */
  id: string;
  kind: ClinicalPanelEntryKind;
  /** Short heading: "Evolución", the drug descriptor, "Régimen"… */
  title: string;
  /** The clinical body (notes / posology / observation). */
  text: string;
  /** The person who signed it ('' when the source row carries no name parts). */
  author: string;
  /** The practitioner role label (Médico, Enfermera(o)…, '' when unknown/numeric). */
  role: string;
  /** Evolutions/shift-change only: sub-tab bucket. */
  profession?: EvolutionProfession;
  publishedAt: string;
  archived: boolean;
  /** Pharma/free indications only: explicitly suspended in Ficha Médico. */
  suspended: boolean;
  /** Pharma only: course explicitly completed in the current medication plan. */
  finalized?: boolean;
  /** Pharma/free indications only: source flag retained for compatibility; not shown in the UI. */
  isNew: boolean;
  /** Evolutions only: struck-through (annulled) note. */
  crossedOut: boolean;
}

/** One calendar day of the indication sheet. */
export interface ClinicalPanelIndicationDay {
  /** Grouping key, YYYY-MM-DD ('' when the source date was unparseable). */
  day: string;
  /** Display label, DD-MM-YYYY. */
  label: string;
  active: ClinicalPanelEntry[];
  suspended: ClinicalPanelEntry[];
}

export interface ClinicalPanel {
  evolutions: ClinicalPanelEntry[];
  indicationDays: ClinicalPanelIndicationDay[];
  careDays: ClinicalPanelCareDay[];
}

type RawRow = Record<string, unknown>;

const str = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value).trim();

/** Ficha Médico flags arrive as booleans, 0/1 or "S"/"N" depending on the resume — accept them all. */
const flag = (value: unknown): boolean => {
  if (value === true || value === 1) return true;
  const s = str(value).toLowerCase();
  return s === 'true' || s === '1' || s === 's' || s === 'si' || s === 'sí';
};

const timeKey = (publishedAt: string): number => {
  const t = Date.parse(publishedAt);
  return Number.isNaN(t) ? 0 : t;
};

const rows = (value: unknown): RawRow[] =>
  Array.isArray(value) ? value.filter((r): r is RawRow => !!r && typeof r === 'object') : [];

const joinParts = (...parts: string[]): string => parts.filter(Boolean).join(' · ');

const byNewestFirst = (a: ClinicalPanelEntry, b: ClinicalPanelEntry): number =>
  timeKey(b.publishedAt) - timeKey(a.publishedAt);

/** The person's display name from the split HCP_* parts (HCPR_NAME is the role, not the person). */
const composeAuthor = (r: RawRow): string =>
  toTitleCaseName(
    [str(r.HCP_FGN), str(r.HCP_NGN), str(r.HCP_FFN), str(r.HCP_SFN)].filter(Boolean).join(' ')
  );

/** Role label for display — drop purely-numeric role ids (we can't name them reliably). */
const roleLabel = (value: unknown): string => {
  const role = str(value);
  return /^\d+$/.test(role) ? '' : role;
};

// Nursing keywords are checked FIRST on purpose: "paramédico" contains "médico", so a médico-first
// test would misfile the whole nursing/technical team as medical. TENS = técnico en enfermería.
const NURSING_ROLE = /param[eé]dic|enfermer|\btens\b|t[eé]cnic[oa].*enfermer|auxiliar.*enfermer/i;
// Physicians: "médico" (any form) OR a surgical/clinical specialty that may omit the word "médico"
// (e.g. "Cirujano", "Traumatólogo"). Extend the list as new role labels show up in Ficha Médico.
const MEDICAL_ROLE =
  /m[eé]dic|cirujan|internist|pediatr|traumat[oó]log|psiquiatr|ginec[oó]|obstetr|anestesi|broncopulmon|cardi[oó]log|neur[oó]log|nefr[oó]log|gastroenter|dermat[oó]log|oftalm[oó]log|otorrino|geriatr|infect[oó]log|reumat[oó]log|hemat[oó]log|onc[oó]log|ur[oó]log|radi[oó]log|intensivist|urgenci[oó]log|becad[oa]|residente/i;

const classifyProfession = (role: string): EvolutionProfession => {
  if (NURSING_ROLE.test(role)) return 'nursing';
  if (MEDICAL_ROLE.test(role)) return 'medical';
  return 'other';
};

/** YYYY-MM-DD day key of a publish datetime ('' when unparseable). */
const dayKey = (publishedAt: string): string => {
  const iso = publishedAt.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const dayLabel = (day: string): string => {
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : day || 'Sin fecha';
};

/** Clinical order inside a day's sheet: régimen → reposo → fármacos → libres. */
const SHEET_ORDER: Record<ClinicalPanelEntryKind, number> = {
  diet: 0,
  rest: 1,
  pharma: 2,
  'free-indication': 3,
  evolution: 9,
  'shift-change': 9,
};

const bySheetOrder = (a: ClinicalPanelEntry, b: ClinicalPanelEntry): number =>
  SHEET_ORDER[a.kind] - SHEET_ORDER[b.kind] || a.title.localeCompare(b.title, 'es');

/**
 * Group indication entries into the daily sheet: dedup within each day (pharma/free by id keeping
 * the latest publication; diet/rest by text), split active vs suspended/archived, newest day first.
 */
const buildIndicationDays = (entries: ClinicalPanelEntry[]): ClinicalPanelIndicationDay[] => {
  const byDay = new Map<string, Map<string, ClinicalPanelEntry>>();
  for (const entry of entries) {
    const day = dayKey(entry.publishedAt);
    const dedupKey =
      entry.kind === 'diet' || entry.kind === 'rest'
        ? `${entry.kind}:${entry.text.toLowerCase()}`
        : `${entry.kind}:${entry.id}`;
    const bucket = byDay.get(day) ?? new Map<string, ClinicalPanelEntry>();
    const current = bucket.get(dedupKey);
    if (!current || timeKey(entry.publishedAt) >= timeKey(current.publishedAt)) {
      bucket.set(dedupKey, entry);
    }
    byDay.set(day, bucket);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, bucket]) => {
      const all = [...bucket.values()].sort(bySheetOrder);
      return {
        day,
        label: dayLabel(day),
        active: all.filter(e => !e.suspended && !e.archived && !e.finalized),
        suspended: all.filter(e => e.suspended || e.archived || e.finalized),
      };
    });
};

export const parseClinicalPanel = (
  events: RayenClinicalPanelEvent[],
  carePlan: RayenClinicalPanelCarePlan = { carePlanHeaders: [], medicationStates: [] }
): ClinicalPanel => {
  const evolutions: ClinicalPanelEntry[] = [];
  const indications: ClinicalPanelEntry[] = [];
  const medicationStates = new Map(
    rows(carePlan.medicationStates).map(row => [str(row.id), row] as const)
  );
  let seq = 0;

  for (const event of Array.isArray(events) ? events : []) {
    if (!event) continue;
    const eventDate = str(event.publishDatetime);

    for (const r of rows(event.evolutionResume)) {
      const text = str(r.OBE_NOTES);
      if (!text) continue;
      const role = roleLabel(r.HCPR_NAME);
      evolutions.push({
        id: str(r.id) || `evolution-${seq++}`,
        kind: 'evolution',
        title: 'Evolución',
        text,
        author: composeAuthor(r),
        role,
        profession: classifyProfession(role),
        publishedAt: str(r.OBE_PUBLISH_DATETIME) || eventDate,
        archived: flag(r.ARCHIVED),
        suspended: false,
        isNew: false,
        crossedOut: flag(r.IS_CROSSED_OUT),
      });
    }

    for (const r of rows(event.shiftChangeResume)) {
      const text = str(r.OBSERVATION);
      if (!text) continue;
      // BOTH doctors and nurses hand over shift — file it by the practitioner's role, not always as
      // nursing (a medical shift-change belongs in the Médicas sub-tab).
      const shiftRole = roleLabel(r.HCPR_NAME);
      evolutions.push({
        id: str(r.ID) || `shift-change-${seq++}`,
        kind: 'shift-change',
        title: 'Entrega de turno',
        text,
        author: composeAuthor(r),
        role: shiftRole,
        profession: classifyProfession(shiftRole),
        publishedAt: str(r.PUBLISH_DATETIME) || eventDate,
        archived: flag(r.ARCHIVED),
        suspended: false,
        isNew: false,
        crossedOut: false,
      });
    }

    for (const r of rows(event.patientPharmaIndicationResume)) {
      const title = str(r.DESCRIPTOR) || str(r.VIRTUAL_MEDICAL_PRODUCT);
      if (!title) continue;
      const currentState = medicationStates.get(str(r.MRE_ID));
      indications.push({
        id: str(r.MRE_ID) || `pharma-${seq++}`,
        kind: 'pharma',
        title,
        text: joinParts(
          str(r.POSOLOGY),
          str(r.ROUTE_ADMINISTRATION),
          str(r.MRE_ADMINISTRATION_NOTE)
        ),
        author: toTitleCaseName(str(r.HCP_NAME)),
        role: roleLabel(r.HCP_ROLE),
        publishedAt: str(r.PUBLISH_DATETIME) || eventDate,
        archived: currentState ? flag(currentState.archived) : flag(r.ARCHIVED),
        suspended: currentState ? flag(currentState.suspended) : flag(r.SUSPENDED),
        finalized: currentState ? flag(currentState.finalized) : false,
        isNew: flag(r.IS_NEW),
        crossedOut: false,
      });
    }

    for (const r of rows(event.patientFreeIndicationResume)) {
      const text = str(r.INDICATION);
      if (!text) continue;
      indications.push({
        id: str(r.AMRE_ID) || `free-${seq++}`,
        kind: 'free-indication',
        title: 'Indicación',
        text,
        author: toTitleCaseName(str(r.HCP_NAME)),
        role: roleLabel(r.HCP_ROLE),
        publishedAt: str(r.PUBLISH_DATETIME) || eventDate,
        archived: flag(r.ARCHIVED),
        suspended: flag(r.SUSPENDED),
        isNew: flag(r.IS_NEW),
        crossedOut: false,
      });
    }

    for (const r of rows(event.nutritionOrderResume)) {
      const text = joinParts(str(r.DIET_type), str(r.OBSERVATION));
      if (!text) continue;
      indications.push({
        id: `diet-${seq++}`,
        kind: 'diet',
        title: 'Régimen',
        text,
        author: '',
        role: roleLabel(r.HCPR_NAME),
        publishedAt: str(r.PUBLISH_DATETIME) || eventDate,
        archived: flag(r.ARCHIVED),
        suspended: false,
        isNew: false,
        crossedOut: false,
      });
    }

    for (const r of rows(event.restResume)) {
      const text = joinParts(str(r.rest_type), str(r.OBSERVATION));
      if (!text) continue;
      indications.push({
        id: `rest-${seq++}`,
        kind: 'rest',
        title: 'Reposo',
        text,
        author: '',
        role: roleLabel(r.HCPR_NAME),
        publishedAt: str(r.PUBLISH_DATETIME) || eventDate,
        archived: flag(r.ARCHIVED),
        suspended: false,
        isNew: false,
        crossedOut: false,
      });
    }
  }

  return {
    evolutions: evolutions.sort(byNewestFirst),
    indicationDays: buildIndicationDays(indications),
    careDays: parseClinicalCareDays(carePlan.carePlanHeaders),
  };
};
