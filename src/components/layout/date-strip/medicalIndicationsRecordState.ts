import {
  buildMedicalIndicationsEpisodeId,
  normalizeMedicalIndicationsDateKey,
  type MedicalIndicationRecord,
  type MedicalIndicationTemplate,
  type MedicalIndicationsKineType,
  type MedicalIndicationsPatientOption,
} from '@/shared/contracts/medicalIndications';

/**
 * The life cycle of the record the medical indications dialog edits, as one small state machine:
 *
 *   closed ──select──▶ loading(visit) ──loaded──▶ ready(visit, saved, draft)
 *                          │
 *                          └──loadFailed──▶ failed(visit)
 *
 * A visit is one opening of a record: its `id` (the clinical episode, which names the patient, and
 * the day: the pair the record is read and saved under) and a `request` number that grows with
 * every opening, also across closing. Every asynchronous answer (the read, a template audit, a
 * save) carries the visit that asked for it and only counts for that visit: leaving a day and
 * coming back is a new visit with a new read, so an older answer can never replace it. Only
 * `ready` has a draft, so only `ready` can be saved, printed or receive a template.
 */

export const INDICATIONS_LINES = 15;

export interface MedicalIndicationsDraft {
  reposo: string;
  regimen: string;
  kineType: MedicalIndicationsKineType;
  kineTimes: string;
  treatingDoctor: string;
  pendingNotes: string;
  /** Always INDICATIONS_LINES entries; empty strings are free lines. */
  lines: string[];
  /** The free-text box under the list. */
  freeText: string;
  /** Templates whose text took a line, in the order they did. */
  templateIds: string[];
  /** The last template could not be added because every line was taken. */
  templateDidNotFit: boolean;
}

/** One opening of a record; see the module comment. */
export interface MedicalIndicationsRecordVisit {
  id: string;
  request: number;
}

export type MedicalIndicationsRecordState =
  | { status: 'closed'; request: number }
  | (MedicalIndicationsRecordVisit & {
      status: 'loading';
      patient: MedicalIndicationsPatientOption;
      targetDate: string;
      /** A save of this record (from an earlier visit) that finished while this read runs. */
      savedMeanwhile: MedicalIndicationRecord | null;
    })
  | (MedicalIndicationsRecordVisit & {
      status: 'ready';
      /** The newest version known for this record. */
      saved: MedicalIndicationRecord | null;
      draft: MedicalIndicationsDraft;
      /** The draft as the read left it: an untouched draft follows a newer save of the record. */
      readDraft: MedicalIndicationsDraft;
      /** The draft this visit saved, when the save finished with exactly it on screen. */
      savedDraft: MedicalIndicationsDraft | null;
    })
  | (MedicalIndicationsRecordVisit & { status: 'failed'; message: string });

export type MedicalIndicationsRecordEvent =
  /** The dialog shows this patient and day, or nothing (closed, no patient, no day). */
  | {
      type: 'select';
      selection: { patient: MedicalIndicationsPatientOption; targetDate: string } | null;
    }
  | {
      type: 'loaded';
      visit: MedicalIndicationsRecordVisit;
      saved: MedicalIndicationRecord | null;
      patient: MedicalIndicationsPatientOption;
    }
  | { type: 'loadFailed'; visit: MedicalIndicationsRecordVisit; message: string }
  | {
      type: 'saved';
      visit: MedicalIndicationsRecordVisit;
      /** The draft that was on screen when the save was asked for. */
      draft: MedicalIndicationsDraft;
      record: MedicalIndicationRecord;
    }
  | {
      type: 'templateAudited';
      visit: MedicalIndicationsRecordVisit;
      template: Pick<MedicalIndicationTemplate, 'id' | 'text'>;
    }
  | {
      type: 'edit';
      visit: MedicalIndicationsRecordVisit;
      update: (draft: MedicalIndicationsDraft) => MedicalIndicationsDraft;
    };

export const CLOSED_RECORD: MedicalIndicationsRecordState = { status: 'closed', request: 0 };

export const buildMedicalIndicationsRecordId = (
  patient: MedicalIndicationsPatientOption,
  targetDate: string
): string =>
  `${buildMedicalIndicationsEpisodeId(patient)}|${normalizeMedicalIndicationsDateKey(targetDate)}`;

export const padIndicationLines = (active: string[]): string[] => [
  ...active,
  ...Array.from({ length: INDICATIONS_LINES - active.length }, () => ''),
];

const activeLines = (lines: string[]) => lines.map(text => text.trim()).filter(Boolean);

const draftFrom = (
  saved: MedicalIndicationRecord | null,
  censusTreatingDoctor: string
): MedicalIndicationsDraft => ({
  reposo: saved?.reposo ?? '',
  regimen: saved?.regimen ?? '',
  kineType: saved?.kineType ?? 'ninguna',
  kineTimes: saved?.kineTimes ?? '',
  treatingDoctor: saved ? saved.treatingDoctor : censusTreatingDoctor,
  pendingNotes: saved?.pendingNotes ?? '',
  lines: padIndicationLines((saved?.indications ?? []).slice(0, INDICATIONS_LINES)),
  freeText: '',
  templateIds: saved?.generatedFromTemplateIds ?? [],
  templateDidNotFit: false,
});

/** The lines with `text` in the first free one, or `null` when every line is taken. */
const placeInFirstFreeLine = (lines: string[], text: string): string[] | null => {
  const firstFreeIndex = lines.findIndex(item => !item.trim());
  if (firstFreeIndex === -1) return null;
  const next = [...lines];
  next[firstFreeIndex] = text;
  return next;
};

/** Adds the free text as a line and empties the box, or leaves both when no line is free. */
export const addFreeText = (draft: MedicalIndicationsDraft): MedicalIndicationsDraft => {
  const text = draft.freeText.trim();
  const lines = text ? placeInFirstFreeLine(draft.lines, text) : null;
  return lines ? { ...draft, lines, freeText: '' } : draft;
};

/** Adds a template's text and credits it, or neither when no line is free (and says so). */
const addTemplate = (
  draft: MedicalIndicationsDraft,
  template: Pick<MedicalIndicationTemplate, 'id' | 'text'>
): MedicalIndicationsDraft => {
  const text = template.text.trim();
  if (!text) return draft;
  const lines = placeInFirstFreeLine(draft.lines, text);
  if (!lines) return { ...draft, templateDidNotFit: true };
  return {
    ...draft,
    lines,
    templateIds: draft.templateIds.includes(template.id)
      ? draft.templateIds
      : [...draft.templateIds, template.id],
    templateDidNotFit: false,
  };
};

export const removeLine = (draft: MedicalIndicationsDraft, index: number) => {
  const active = activeLines(draft.lines);
  active.splice(index, 1);
  return { ...draft, lines: padIndicationLines(active) };
};

export const moveLine = (
  draft: MedicalIndicationsDraft,
  index: number,
  direction: 'up' | 'down'
) => {
  const active = activeLines(draft.lines);
  const destination = direction === 'up' ? index - 1 : index + 1;
  const moving = active[index];
  const other = active[destination];
  if (moving === undefined || other === undefined) return draft;
  active[index] = other;
  active[destination] = moving;
  return { ...draft, lines: padIndicationLines(active) };
};

export const replaceLine = (draft: MedicalIndicationsDraft, index: number, text: string) => {
  const active = activeLines(draft.lines);
  active[index] = text;
  return { ...draft, lines: padIndicationLines(active) };
};

/** The newer of two versions of the same record (versions are never edited, only added). */
const newest = (
  left: MedicalIndicationRecord | null,
  right: MedicalIndicationRecord | null
): MedicalIndicationRecord | null => {
  if (!left || !right) return left ?? right;
  return right.generatedAt > left.generatedAt ? right : left;
};

const isVisit = (state: MedicalIndicationsRecordState, visit: MedicalIndicationsRecordVisit) =>
  state.status !== 'closed' && state.id === visit.id && state.request === visit.request;

/** A save finished for the record on screen. */
const applySave = (
  state: MedicalIndicationsRecordState,
  event: Extract<MedicalIndicationsRecordEvent, { type: 'saved' }>
): MedicalIndicationsRecordState => {
  if (state.status === 'closed' || state.id !== event.visit.id) return state;
  if (state.status === 'loading') {
    return { ...state, savedMeanwhile: newest(state.savedMeanwhile, event.record) };
  }
  if (state.status === 'failed') return state;
  if (state.request === event.visit.request) {
    // Confirmed only when nothing was edited while the save was in flight.
    return {
      ...state,
      saved: newest(state.saved, event.record),
      savedDraft: state.draft === event.draft ? event.draft : state.savedDraft,
    };
  }
  // Saved during an earlier visit, after this visit's read: the record moved on. An untouched
  // draft follows it; an edited one keeps the edits (and never shows as saved).
  if (newest(state.saved, event.record) !== event.record) return state;
  if (state.draft !== state.readDraft) return { ...state, saved: event.record };
  const draft = draftFrom(event.record, '');
  return { ...state, saved: event.record, draft, readDraft: draft };
};

export const reduceMedicalIndicationsRecord = (
  state: MedicalIndicationsRecordState,
  event: MedicalIndicationsRecordEvent
): MedicalIndicationsRecordState => {
  switch (event.type) {
    case 'select': {
      if (!event.selection) {
        return state.status === 'closed' ? state : { status: 'closed', request: state.request };
      }
      const { patient, targetDate } = event.selection;
      const id = buildMedicalIndicationsRecordId(patient, targetDate);
      // A census refresh of the same patient and day keeps whatever is loaded or being edited.
      if (state.status !== 'closed' && state.id === id) return state;
      return {
        status: 'loading',
        id,
        request: state.request + 1,
        patient,
        targetDate,
        savedMeanwhile: null,
      };
    }
    case 'loaded': {
      if (!isVisit(state, event.visit)) return state;
      // A second answer for the same visit never overwrites what is being edited.
      if (state.status === 'ready') return { ...state, saved: newest(state.saved, event.saved) };
      if (state.status !== 'loading') return state;
      const saved = newest(event.saved, state.savedMeanwhile);
      const draft = draftFrom(saved, event.patient.treatingDoctor || '');
      return {
        status: 'ready',
        id: state.id,
        request: state.request,
        saved,
        draft,
        readDraft: draft,
        savedDraft: null,
      };
    }
    case 'loadFailed':
      return state.status === 'loading' && isVisit(state, event.visit)
        ? { status: 'failed', id: state.id, request: state.request, message: event.message }
        : state;
    case 'saved':
      return applySave(state, event);
    case 'templateAudited':
      return state.status === 'ready' && isVisit(state, event.visit)
        ? { ...state, draft: addTemplate(state.draft, event.template) }
        : state;
    case 'edit':
      return state.status === 'ready' && isVisit(state, event.visit)
        ? { ...state, draft: event.update(state.draft) }
        : state;
  }
};
