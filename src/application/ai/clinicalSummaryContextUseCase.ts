import { buildClinicalEpisodeKey } from '@/application/patient-flow/clinicalEpisode';
import type { ClinicalAISummaryRecordContract } from '@/application/ai/clinicalSummaryContextContracts';
import type { ClinicalDocumentRecord } from '@/domain/clinical-documents/entities';
import { resolveNursingHandoffNovedadesText } from '@/shared/handoff/handoffNovedades';

const MAX_DOCUMENT_TEXT_LENGTH = 4000;

const truncateText = (value: string | undefined, maxLength = MAX_DOCUMENT_TEXT_LENGTH): string => {
  const normalized = value?.trim() || '';
  if (!normalized) {
    return '';
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}…`;
};

const buildDocumentText = (document: ClinicalDocumentRecord): string => {
  if (document.renderedText?.trim()) {
    return truncateText(document.renderedText);
  }

  const sectionsText = document.sections
    .map(section => `${section.title}:\n${section.content}`.trim())
    .filter(Boolean)
    .join('\n\n');

  return truncateText(sectionsText);
};

const serializeEntries = <T>(entries: T[] | undefined): T[] => (entries ? [...entries] : []);

export interface ClinicalAISummaryDocument {
  id: string;
  type: ClinicalDocumentRecord['documentType'];
  title: string;
  status: ClinicalDocumentRecord['status'];
  updatedAt: string;
  renderedText: string;
}

export interface ClinicalAISummaryContext {
  recordDate: string;
  bedId: string;
  episodeKey: string;
  patient: {
    name: string;
    rut: string;
    age: string;
    admissionDate: string;
    admissionTime?: string;
    specialty: string;
    secondarySpecialty?: string;
    status: string;
    diagnosis: string;
    diagnosisComments?: string;
    cie10Code?: string;
    cie10Description?: string;
    devices: string[];
    clinicalEvents: unknown[];
    medicalHandoffNote?: string;
    medicalHandoffEntries: unknown[];
    handoffNoteDayShift?: string;
    handoffNoteNightShift?: string;
  };
  nursingHandoff: {
    nursesDayShift: string[];
    nursesNightShift: string[];
    tensDayShift: string[];
    tensNightShift: string[];
    novedadesDayShift?: string;
    novedadesNightShift?: string;
    dayChecklist?: ClinicalAISummaryRecordContract['handoffDayChecklist'];
    nightChecklist?: ClinicalAISummaryRecordContract['handoffNightChecklist'];
  };
  medicalHandoff: {
    globalNote?: string;
    bySpecialty?: ClinicalAISummaryRecordContract['medicalHandoffBySpecialty'];
    doctor?: string;
    signature?: ClinicalAISummaryRecordContract['medicalSignature'];
  };
  clinicalDocuments: ClinicalAISummaryDocument[];
}

export const buildClinicalAISummaryContext = ({
  record,
  bedId,
  documents,
}: {
  record: ClinicalAISummaryRecordContract;
  bedId: string;
  documents: ClinicalDocumentRecord[];
}): ClinicalAISummaryContext => {
  const patient = record.beds[bedId];

  if (!patient?.patientName) {
    throw new Error(`Patient not found for bed '${bedId}' on record '${record.date}'.`);
  }

  const episodeKey = buildClinicalEpisodeKey(
    patient.rut || '',
    patient.admissionDate,
    patient.admissionTime
  );

  return {
    recordDate: record.date,
    bedId,
    episodeKey,
    patient: {
      name: patient.patientName || '',
      rut: patient.rut || '',
      age: patient.age || '',
      admissionDate: patient.admissionDate || '',
      admissionTime: patient.admissionTime,
      specialty: patient.specialty || '',
      secondarySpecialty: patient.secondarySpecialty,
      status: patient.status || '',
      diagnosis: patient.pathology || '',
      diagnosisComments: patient.diagnosisComments,
      cie10Code: patient.cie10Code,
      cie10Description: patient.cie10Description,
      devices: serializeEntries(patient.devices),
      clinicalEvents: serializeEntries(patient.clinicalEvents),
      medicalHandoffNote: patient.medicalHandoffNote,
      medicalHandoffEntries: serializeEntries(patient.medicalHandoffEntries),
      handoffNoteDayShift: patient.handoffNoteDayShift,
      handoffNoteNightShift: patient.handoffNoteNightShift,
    },
    nursingHandoff: {
      nursesDayShift: serializeEntries(record.nursesDayShift),
      nursesNightShift: serializeEntries(record.nursesNightShift),
      tensDayShift: serializeEntries(record.tensDayShift),
      tensNightShift: serializeEntries(record.tensNightShift),
      novedadesDayShift: record.handoffNovedadesDayShift,
      novedadesNightShift: resolveNursingHandoffNovedadesText({
        selectedShift: 'night',
        handoffNovedadesDayShift: record.handoffNovedadesDayShift,
        handoffNovedadesNightShift: record.handoffNovedadesNightShift,
      }),
      dayChecklist: record.handoffDayChecklist,
      nightChecklist: record.handoffNightChecklist,
    },
    medicalHandoff: {
      globalNote: record.medicalHandoffNovedades,
      bySpecialty: record.medicalHandoffBySpecialty,
      doctor: record.medicalHandoffDoctor,
      signature: record.medicalSignature,
    },
    clinicalDocuments: documents.map(document => ({
      id: document.id,
      type: document.documentType,
      title: document.title,
      status: document.status,
      updatedAt: document.audit.updatedAt,
      renderedText: buildDocumentText(document),
    })),
  };
};

const buildSectionsText = (sections: ClinicalAISummaryContext['clinicalDocuments']): string => {
  if (sections.length === 0) {
    return 'No hay documentos clínicos asociados a este episodio.';
  }

  return sections
    .map(
      document =>
        `Documento: ${document.title} (${document.type}, ${document.status}, actualizado ${document.updatedAt})\n${document.renderedText}`
    )
    .join('\n\n---\n\n');
};

export const buildClinicalAISummaryPrompt = ({
  context,
  instruction,
}: {
  context: ClinicalAISummaryContext;
  instruction?: string;
}) => ({
  systemPrompt:
    'Eres un asistente clínico de apoyo para el Hospital Hanga Roa. Debes responder en español, de forma técnica, concisa y segura. Nunca inventes datos ausentes. Si falta información, dilo explícitamente. No emitas indicaciones terapéuticas tajantes ni reemplaces juicio médico; prioriza resumir el contexto disponible.',
  userPrompt: `
Genera un resumen clínico del paciente usando exclusivamente el contexto entregado.

Objetivo específico del usuario:
${instruction?.trim() || 'Entregar un resumen clínico estructurado, útil para continuidad de atención.'}

Formato sugerido:
1. Identificación y motivo clínico principal
2. Estado actual relevante
3. Entrega de turno de enfermería relevante
4. Entrega de turno médica relevante
5. Hallazgos relevantes en documentos clínicos
6. Vacíos de información o puntos a confirmar

Contexto del episodio:
- Fecha del registro: ${context.recordDate}
- Cama: ${context.bedId}
- Episode key: ${context.episodeKey}

Paciente:
- Nombre: ${context.patient.name}
- RUT: ${context.patient.rut}
- Edad: ${context.patient.age}
- Fecha ingreso: ${context.patient.admissionDate || 'Sin dato'}
- Hora ingreso: ${context.patient.admissionTime || 'Sin dato'}
- Especialidad: ${context.patient.specialty || 'Sin dato'}
- Especialidad secundaria: ${context.patient.secondarySpecialty || 'Sin dato'}
- Estado paciente: ${context.patient.status || 'Sin dato'}
- Diagnóstico principal: ${context.patient.diagnosis || 'Sin dato'}
- Comentarios diagnósticos: ${context.patient.diagnosisComments || 'Sin dato'}
- CIE-10: ${context.patient.cie10Code || 'Sin dato'} ${context.patient.cie10Description ? `(${context.patient.cie10Description})` : ''}
- Dispositivos: ${context.patient.devices.length > 0 ? context.patient.devices.join(', ') : 'Sin dispositivos registrados'}
- Nota enfermería día: ${context.patient.handoffNoteDayShift || 'Sin nota'}
- Nota enfermería noche: ${context.patient.handoffNoteNightShift || 'Sin nota'}
- Nota médica paciente: ${context.patient.medicalHandoffNote || 'Sin nota'}
- Entradas médicas por especialidad: ${JSON.stringify(context.patient.medicalHandoffEntries || [])}
- Eventos clínicos: ${JSON.stringify(context.patient.clinicalEvents || [])}

Entrega de turno enfermería:
- Novedades turno largo: ${context.nursingHandoff.novedadesDayShift || 'Sin novedades'}
- Novedades turno noche: ${context.nursingHandoff.novedadesNightShift || 'Sin novedades'}
- Checklist turno largo: ${JSON.stringify(context.nursingHandoff.dayChecklist || {})}
- Checklist turno noche: ${JSON.stringify(context.nursingHandoff.nightChecklist || {})}
- Enfermeras turno largo: ${context.nursingHandoff.nursesDayShift.join(', ') || 'Sin dato'}
- Enfermeras turno noche: ${context.nursingHandoff.nursesNightShift.join(', ') || 'Sin dato'}
- TENS turno largo: ${context.nursingHandoff.tensDayShift.join(', ') || 'Sin dato'}
- TENS turno noche: ${context.nursingHandoff.tensNightShift.join(', ') || 'Sin dato'}

Entrega de turno médica:
- Novedades globales: ${context.medicalHandoff.globalNote || 'Sin novedades'}
- Médico a cargo: ${context.medicalHandoff.doctor || 'Sin dato'}
- Firma médica: ${context.medicalHandoff.signature ? JSON.stringify(context.medicalHandoff.signature) : 'Sin firma'}
- Por especialidad: ${JSON.stringify(context.medicalHandoff.bySpecialty || {})}

Documentos clínicos:
${buildSectionsText(context.clinicalDocuments)}
`.trim(),
});
