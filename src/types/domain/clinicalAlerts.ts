/**
 * One active note from the «Alertas» section of the episode's Eloísa chart, as read by the
 * census sync of that clinical day. Archived, deleted and unsigned notes are not kept.
 */
export interface PatientClinicalAlert {
  /** Eloísa's note identity, stable across reads. */
  id: string;
  text: string;
  /** Rapa Nui wall clock of the note, `YYYY-MM-DDTHH:mm`. */
  recordedAt: string;
  author?: string;
  role?: string;
  /** Eloísa marks notes meant for visitors. */
  visitor?: boolean;
}
