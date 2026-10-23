import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';
import type { ClinicalDocumentTemplate } from '@/features/clinical-documents/domain/entities';

export const localTemplate: ClinicalDocumentTemplate = {
  id: 'epicrisis',
  name: 'Epicrisis local',
  title: 'Epicrisis',
  version: 1,
  patientFields: [],
  sections: [],
  allowCustomTitle: false,
  allowAddSection: false,
  allowClinicalUpdateSections: false,
  status: 'active',
  documentType: 'epicrisis',
  defaultPatientInfoTitle: 'Información del paciente',
  defaultFooterMedicoLabel: 'Médico',
  defaultFooterEspecialidadLabel: 'Especialidad',
};

export const remoteTemplate: ClinicalDocumentTemplate = {
  id: 'evolucion',
  name: 'Evolucion remota',
  title: 'Evolución',
  version: 1,
  patientFields: [],
  sections: [],
  allowCustomTitle: false,
  allowAddSection: false,
  allowClinicalUpdateSections: false,
  status: 'active',
  documentType: 'evolucion',
  defaultPatientInfoTitle: 'Información del paciente',
  defaultFooterMedicoLabel: 'Médico',
  defaultFooterEspecialidadLabel: 'Especialidad',
};

export const patient: {
  patientName: string;
  rut: string;
  specialty: string;
  clinicalEpisodeId?: string;
} = {
  patientName: 'Paciente Test',
  rut: '11.111.111-1',
  specialty: 'Medicina',
};

export const buildDocument = (
  overrides: Partial<ReturnType<typeof createClinicalDocumentDraft>> = {}
) => ({
  ...createClinicalDocumentDraft({
    templateId: 'epicrisis',
    hospitalId: 'hhr',
    actor: {
      uid: 'u1',
      email: 'doctor@test.com',
      displayName: 'Doctor Test',
      role: 'doctor_urgency',
    },
    episode: {
      patientRut: '11.111.111-1',
      patientName: 'Paciente Test',
      episodeKey: '11.111.111-1__2026-03-06',
      admissionDate: '2026-03-06',
      sourceDailyRecordDate: '2026-03-06',
      sourceBedId: 'R1',
      specialty: 'Medicina',
    },
    patientFieldValues: {
      nombre: 'Paciente Test',
      rut: '11.111.111-1',
      edad: '40a',
      fecnac: '1986-01-01',
      fing: '2026-03-06',
      finf: '2026-03-06',
      hinf: '10:30',
    },
    medico: 'Doctor Test',
    especialidad: 'Medicina',
  }),
  ...overrides,
});
