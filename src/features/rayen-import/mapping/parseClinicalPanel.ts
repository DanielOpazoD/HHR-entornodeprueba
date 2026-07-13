/**
 * Parser for the per-patient CLINICAL PANEL (evoluciones + indicaciones) from Ficha Médico's
 * history-report events (relayed slimmed by the extension — see `clinicalPanelBridge`).
 *
 * Pure: raw events in → two ready-to-render lists out (newest first):
 *   - `evolutions`  → medical evolutions (`evolutionResume`, field OBE_NOTES) + nursing
 *                     shift-change notes (`shiftChangeResume`, field OBSERVATION).
 *   - `indications` → pharma (`patientPharmaIndicationResume`), free-text indications
 *                     (`patientFreeIndicationResume`), diet (`nutritionOrderResume`) and rest
 *                     (`restResume`).
 *
 * The report repeats an indication on every event that re-publishes it, so pharma/free entries are
 * deduped by their stable id (MRE_ID / AMRE_ID) keeping the LATEST publication — that's the row
 * whose SUSPENDED/ARCHIVED flags reflect the current state. Nothing here is persisted: the panel is
 * a live, on-demand view.
 */

import type { RayenClinicalPanelEvent } from '../bridge/clinicalPanelBridge';

export type ClinicalPanelEntryKind =
  | 'evolution'
  | 'shift-change'
  | 'pharma'
  | 'free-indication'
  | 'diet'
  | 'rest';

export interface ClinicalPanelEntry {
  /** Stable within one parse — source id when the row has one, positional otherwise. */
  id: string;
  kind: ClinicalPanelEntryKind;
  /** Short heading: "Evolución médica", the drug descriptor, "Régimen"… */
  title: string;
  /** The clinical body (notes / posology / observation). */
  text: string;
  author: string;
  publishedAt: string;
  archived: boolean;
  /** Pharma/free indications only: explicitly suspended in Ficha Médico. */
  suspended: boolean;
  /** Pharma/free indications only: flagged as new by Ficha Médico. */
  isNew: boolean;
  /** Evolutions only: struck-through (annulled) note. */
  crossedOut: boolean;
}

export interface ClinicalPanel {
  evolutions: ClinicalPanelEntry[];
  indications: ClinicalPanelEntry[];
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

/** Keep one entry per id — the latest publication wins (its flags reflect the current state). */
const dedupeLatestById = (entries: ClinicalPanelEntry[]): ClinicalPanelEntry[] => {
  const latest = new Map<string, ClinicalPanelEntry>();
  for (const entry of entries) {
    const current = latest.get(entry.id);
    if (!current || timeKey(entry.publishedAt) >= timeKey(current.publishedAt)) {
      latest.set(entry.id, entry);
    }
  }
  return [...latest.values()];
};

export const parseClinicalPanel = (events: RayenClinicalPanelEvent[]): ClinicalPanel => {
  const evolutions: ClinicalPanelEntry[] = [];
  const pharma: ClinicalPanelEntry[] = [];
  const free: ClinicalPanelEntry[] = [];
  const dietRest: ClinicalPanelEntry[] = [];
  let seq = 0;

  for (const event of Array.isArray(events) ? events : []) {
    if (!event) continue;
    const eventDate = str(event.publishDatetime);

    for (const r of rows(event.evolutionResume)) {
      const text = str(r.OBE_NOTES);
      if (!text) continue;
      evolutions.push({
        id: str(r.id) || `evolution-${seq++}`,
        kind: 'evolution',
        title: 'Evolución médica',
        text,
        author: str(r.HCPR_NAME),
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
      evolutions.push({
        id: str(r.ID) || `shift-change-${seq++}`,
        kind: 'shift-change',
        title: 'Entrega de turno · Enfermería',
        text,
        author: str(r.HCPR_NAME),
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
      pharma.push({
        id: str(r.MRE_ID) || `pharma-${seq++}`,
        kind: 'pharma',
        title,
        text: joinParts(
          str(r.POSOLOGY),
          str(r.ROUTE_ADMINISTRATION),
          str(r.MRE_ADMINISTRATION_NOTE)
        ),
        author: str(r.HCP_NAME),
        publishedAt: str(r.PUBLISH_DATETIME) || eventDate,
        archived: flag(r.ARCHIVED),
        suspended: flag(r.SUSPENDED),
        isNew: flag(r.IS_NEW),
        crossedOut: false,
      });
    }

    for (const r of rows(event.patientFreeIndicationResume)) {
      const text = str(r.INDICATION);
      if (!text) continue;
      free.push({
        id: str(r.AMRE_ID) || `free-${seq++}`,
        kind: 'free-indication',
        title: 'Indicación',
        text,
        author: str(r.HCP_NAME),
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
      dietRest.push({
        id: `diet-${seq++}`,
        kind: 'diet',
        title: 'Régimen',
        text,
        author: str(r.HCPR_NAME),
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
      dietRest.push({
        id: `rest-${seq++}`,
        kind: 'rest',
        title: 'Reposo',
        text,
        author: str(r.HCPR_NAME),
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
    indications: [...dedupeLatestById(pharma), ...dedupeLatestById(free), ...dietRest].sort(
      byNewestFirst
    ),
  };
};
