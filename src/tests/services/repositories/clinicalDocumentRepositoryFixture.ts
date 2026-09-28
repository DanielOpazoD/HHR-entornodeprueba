import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';

export const buildDoc = (
  id: string,
  episodeKey: string,
  updatedAt: string,
  status: ClinicalDocumentRecord['status'] = 'draft'
): ClinicalDocumentRecord =>
  ({
    id,
    hospitalId: 'hhr',
    documentType: 'epicrisis',
    templateId: 'epicrisis',
    templateVersion: 1,
    title: 'Epicrisis médica',
    patientInfoTitle: 'Información del Paciente',
    footerMedicoLabel: 'Médico',
    footerEspecialidadLabel: 'Especialidad',
    patientRut: '1-9',
    patientName: 'Paciente Test',
    episodeKey,
    admissionDate: '2026-03-05',
    sourceDailyRecordDate: '2026-03-05',
    sourceBedId: 'R1',
    patientFields: [],
    sections: [],
    medico: 'Dr. Test',
    especialidad: 'Medicina Interna',
    status,
    isLocked: false,
    isActiveEpisodeDocument: true,
    currentVersion: 1,
    versionHistory: [],
    audit: {
      createdAt: updatedAt,
      createdBy: {
        uid: 'u1',
        email: 'test@hospital.cl',
        displayName: 'Test',
        role: 'doctor_urgency',
      },
      updatedAt,
      updatedBy: {
        uid: 'u1',
        email: 'test@hospital.cl',
        displayName: 'Test',
        role: 'doctor_urgency',
      },
      signatureRevocations: [],
    },
    renderedText: 'texto',
    integrityHash: 'hash',
  }) as ClinicalDocumentRecord;
