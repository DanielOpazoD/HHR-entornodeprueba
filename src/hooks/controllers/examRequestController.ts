/** Lines of the form the person may type on before printing. */
export type ExamRequestFreeTextField = 'otros' | 'medicoTratante';

export type ExamRequestFreeText = Record<ExamRequestFreeTextField, string>;

export interface ExamRequestOpenState {
  selectedExams: Set<string>;
  procedencia: string;
  prevision: string;
  /** Text typed on those lines, per print only: never saved with the patient. */
  freeText: ExamRequestFreeText;
}

const DEFAULT_PROCEDENCIA = 'Hospitalización';
const DEFAULT_PREVISION = 'FONASA';

export const resolveExamRequestPrevision = (insurance?: string): string => {
  const normalizedInsurance = insurance?.trim();
  return (normalizedInsurance || DEFAULT_PREVISION).toUpperCase();
};

export const buildExamRequestOpenState = (insurance?: string): ExamRequestOpenState => ({
  selectedExams: new Set(),
  procedencia: DEFAULT_PROCEDENCIA,
  prevision: resolveExamRequestPrevision(insurance),
  freeText: { otros: '', medicoTratante: '' },
});

export const toggleExamRequestSelection = (
  selectedExams: ReadonlySet<string>,
  examKey: string
): Set<string> => {
  const next = new Set(selectedExams);
  if (next.has(examKey)) {
    next.delete(examKey);
  } else {
    next.add(examKey);
  }
  return next;
};

export const countSelectedExamRequests = (selectedExams: ReadonlySet<string>): number =>
  selectedExams.size;
