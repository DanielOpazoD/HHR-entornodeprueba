import { getExamCategoryById, type ExamCategory } from '@/constants/examCategories';
import type { PatientData } from '@/types/domain/patient';
import type { ExamRequestFreeTextField } from '@/hooks/controllers/examRequestController';
import { normalizeRut } from '@/utils/rutUtils';

interface ExamRequestSectionModel {
  title: string;
  tube?: string;
  exams: string[];
  columns?: 1 | 2;
  muted?: boolean;
}

interface ExamRequestColumnModel {
  sections: ExamRequestSectionModel[];
  footerLabel?: string;
  footerExams?: string[];
}

interface ExamRequestFooterFieldModel {
  label: string;
  lines?: number;
  /** Typed before printing; without it the line stays blank for handwriting. */
  freeText?: ExamRequestFreeTextField;
}

export interface ExamRequestModalShellModel {
  title: string;
  subtitle: string;
  patientName: string;
  patientRut?: string;
  patientPathology?: string;
  patientBedName?: string;
}

const bioquimica = getExamCategoryById('bioquimica');
const hematologia = getExamCategoryById('hematologia');
const coagulacion = getExamCategoryById('coagulacion');
const hormonas = getExamCategoryById('hormonas');
const microbiologicos = getExamCategoryById('microbiologicos');
const orina = getExamCategoryById('orina');
const parasitologia = getExamCategoryById('parasitologia');
const virologia = getExamCategoryById('virologia');
const inmunologia = getExamCategoryById('inmunologia');
const otros = getExamCategoryById('otros');

const greenTubeSection = {
  label: 'TUBO VERDE',
  exams: ['ELECTROLITOS PLASMATICOS', 'LACTATO'],
} as const;

export const buildExamRequestModalShellModel = (
  patient: PatientData
): ExamRequestModalShellModel => ({
  title: 'Solicitud de Laboratorio',
  subtitle: patient.patientName,
  patientName: patient.patientName,
  patientRut: patient.rut,
  patientPathology: patient.pathology,
  patientBedName: patient.bedName,
});

const unprovenPatientKeys = new WeakMap<PatientData, string>();
let unprovenPatientCount = 0;

/**
 * Who a single-patient request belongs to: the episode, or else the document and admission. The
 * bed is only a place, so a new patient in the same bed starts a blank request. Without episode or
 * document nothing proves it is the same person, so every new patient record starts blank.
 */
export const resolveExamRequestPatientIdentity = (patient: PatientData): string => {
  if (patient.clinicalEpisodeId) return `episode:${patient.clinicalEpisodeId}`;
  const documentType = patient.documentType ?? 'RUT';
  // A passport is never read as a RUT.
  const document =
    documentType === 'RUT' ? normalizeRut(patient.rut) : (patient.rut ?? '').trim().toUpperCase();
  if (document) return [documentType, document, patient.admissionDate ?? ''].join(':');
  let unprovenKey = unprovenPatientKeys.get(patient);
  if (!unprovenKey) {
    unprovenPatientCount += 1;
    unprovenKey = `unproven:${unprovenPatientCount}`;
    unprovenPatientKeys.set(patient, unprovenKey);
  }
  return unprovenKey;
};

export const buildExamRequestFormColumns = (): ExamRequestColumnModel[] => [
  {
    sections: [mapCategorySection(bioquimica)],
    footerLabel: greenTubeSection.label,
    footerExams: [...greenTubeSection.exams],
  },
  {
    sections: [
      mapCategorySection(hematologia, { columns: 2 }),
      mapCategorySection(coagulacion),
      mapCategorySection(microbiologicos, { muted: true }),
    ],
  },
  {
    sections: [
      mapCategorySection(hormonas),
      {
        title: 'Orina / Parásitos',
        exams: [...orina.exams, ...parasitologia.exams],
      },
      {
        title: 'Virología / Otros',
        exams: [...virologia.exams, ...otros.exams],
      },
    ],
  },
];

export const buildExamRequestFooterSection = (): ExamRequestSectionModel =>
  mapCategorySection(inmunologia);

export const buildExamRequestFooterFields = (): ExamRequestFooterFieldModel[] => [
  { label: 'OTROS', lines: 2, freeText: 'otros' },
  { label: 'MEDICO TRATANTE', lines: 1, freeText: 'medicoTratante' },
  { label: 'FIRMA', lines: 1 },
];

const mapCategorySection = (
  category: ExamCategory,
  options?: { columns?: 1 | 2; muted?: boolean }
): ExamRequestSectionModel => ({
  title: category.name,
  tube: category.tube,
  exams: category.exams,
  columns: options?.columns,
  muted: options?.muted,
});
