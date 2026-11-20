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
 *   closed ──select──▶ loading(id) ──loaded──▶ ready(id, saved, draft)
 *                          │                       │
 *                          └──loadFailed──▶ failed(id)
 *
 * `id` is the record's identity: the clinical episode (which names the patient) and the day, the
 * same pair the record is read and saved under. Every asynchronous answer (the read, a template
 * audit) carries the id that asked for it and is ignored when the dialog is on another id. Only
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

export type MedicalIndicationsRecordState =
  | { status: 'closed' }
  | { status: 'loading'; id: string; patient: MedicalIndicationsPatientOption; targetDate: string }
  | {
      status: 'ready';
      id: string;
      saved: MedicalIndicationRecord | null;
      draft: MedicalIndicationsDraft;
    }
  | { status: 'failed'; id: string; message: string };

export type MedicalIndicationsRecordEvent =
  /** The dialog shows this patient and day, or nothing (closed, no patient, no day). */
  | {
      type: 'select';
      selection: { patient: MedicalIndicationsPatientOption; targetDate: string } | null;
    }
  | {
      type: 'loaded';
      id: string;
      saved: MedicalIndicationRecord | null;
      patient: MedicalIndicationsPatientOption;
    }
  | { type: 'loadFailed'; id: string; message: string }
  | { type: 'saved'; id: string; record: MedicalIndicationRecord }
  | {
      type: 'templateAudited';
      id: string;
      template: Pick<MedicalIndicationTemplate, 'id' | 'text'>;
    }
  | {
      type: 'edit';
      id: string;
      update: (draft: MedicalIndicationsDraft) => MedicalIndicationsDraft;
    };

export const CLOSED_RECORD: MedicalIndicationsRecordState = { status: 'closed' };

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
  patient: MedicalIndicationsPatientOption
): MedicalIndicationsDraft => ({
  reposo: saved?.reposo ?? '',
  regimen: saved?.regimen ?? '',
  kineType: saved?.kineType ?? 'ninguna',
  kineTimes: saved?.kineTimes ?? '',
  treatingDoctor: saved ? saved.treatingDoctor : patient.treatingDoctor || '',
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

const isOn = (state: MedicalIndicationsRecordState, id: string) =>
  state.status !== 'closed' && state.id === id;

export const reduceMedicalIndicationsRecord = (
  state: MedicalIndicationsRecordState,
  event: MedicalIndicationsRecordEvent
): MedicalIndicationsRecordState => {
  switch (event.type) {
    case 'select': {
      if (!event.selection) return state.status === 'closed' ? state : CLOSED_RECORD;
      const { patient, targetDate } = event.selection;
      const id = buildMedicalIndicationsRecordId(patient, targetDate);
      // A census refresh of the same patient and day keeps whatever is loaded or being edited.
      if (isOn(state, id)) return state;
      return { status: 'loading', id, patient, targetDate };
    }
    case 'loaded': {
      if (!isOn(state, event.id)) return state;
      // A second answer for the same record never overwrites what is being edited.
      if (state.status === 'ready') return { ...state, saved: event.saved };
      return {
        status: 'ready',
        id: event.id,
        saved: event.saved,
        draft: draftFrom(event.saved, event.patient),
      };
    }
    case 'loadFailed':
      return state.status === 'loading' && state.id === event.id
        ? { status: 'failed', id: event.id, message: event.message }
        : state;
    case 'saved':
      return state.status === 'ready' && state.id === event.id
        ? { ...state, saved: event.record }
        : state;
    case 'templateAudited':
      return state.status === 'ready' && state.id === event.id
        ? { ...state, draft: addTemplate(state.draft, event.template) }
        : state;
    case 'edit':
      return state.status === 'ready' && state.id === event.id
        ? { ...state, draft: event.update(state.draft) }
        : state;
  }
};
