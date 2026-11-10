import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useClinicalDocumentWorkspaceBootstrap } from '@/features/clinical-documents/hooks/useClinicalDocumentWorkspaceBootstrap';
import {
  createClinicalDocumentDraft,
  restoreClinicalDocumentDraftTemplate,
} from '@/features/clinical-documents/domain/factories';
import { hydrateClinicalDocumentWorkspaceRecord } from '@/features/clinical-documents/controllers/clinicalDocumentWorkspaceController';
import { buildDocument, patient } from './useClinicalDocumentWorkspaceBootstrap.fixtures';

vi.mock('@/application/clinical-documents/clinicalDocumentUseCases', () => ({
  subscribeClinicalDocumentsByEpisodeKeys: () => () => undefined,
}));

const loadedOptions = [
  ['epicrisis', 'Epicrisis médica'],
  ['epicrisis_traslado', 'Epicrisis médica de traslado'],
  ['evolucion', 'Evolución médica'],
  ['informe_medico', 'Informe médico'],
  ['otro', 'Otro documento'],
];
const renderBootstrap = () =>
  renderHook(() =>
    useClinicalDocumentWorkspaceBootstrap({
      patient,
      currentDateString: '2026-03-06',
      bedId: 'R1',
      isActive: true,
      canRead: true,
      hospitalId: 'synthetic-hospital',
      role: 'admin',
    })
  );
const options = (
  templates: ReturnType<typeof useClinicalDocumentWorkspaceBootstrap>['templates']
) => templates.map(({ id, name }) => [id, name]);
const shape = (draft: ReturnType<typeof createClinicalDocumentDraft>) => ({
  templateId: draft.templateId,
  templateVersion: draft.templateVersion,
  documentType: draft.documentType,
  title: draft.title,
  patientInfoTitle: draft.patientInfoTitle,
  footerMedicoLabel: draft.footerMedicoLabel,
  footerEspecialidadLabel: draft.footerEspecialidadLabel,
  patientRut: draft.patientRut,
  patientName: draft.patientName,
  episodeKey: draft.episodeKey,
  admissionDate: draft.admissionDate,
  sourceDailyRecordDate: draft.sourceDailyRecordDate,
  sourceBedId: draft.sourceBedId,
  patientFields: draft.patientFields,
  sections: draft.sections,
});
const createDraft = (templateId: string) => {
  const base = buildDocument();
  return createClinicalDocumentDraft({
    templateId,
    hospitalId: base.hospitalId,
    actor: base.audit.createdBy,
    episode: {
      patientRut: base.patientRut,
      patientName: base.patientName,
      episodeKey: base.episodeKey,
      admissionDate: base.admissionDate,
      sourceDailyRecordDate: base.sourceDailyRecordDate,
      sourceBedId: base.sourceBedId,
      specialty: 'Medicina',
    },
    patientFieldValues: Object.fromEntries(
      base.patientFields.map(field => [field.id, field.value])
    ),
    medico: base.medico,
    especialidad: base.especialidad,
  });
};

describe('current fixed clinical template behaviour on main', () => {
  it('offers the five fixed options on first render', () => {
    const { result } = renderBootstrap();
    expect(options(result.current.templates)).toEqual(loadedOptions);
  });

  for (const [id] of loadedOptions) {
    it(`preserves creation, reset, template change and saved hydration for ${id}`, () => {
      const draft = createDraft(id);
      expect(shape(draft)).toMatchSnapshot();
      const edited = {
        ...draft,
        title: 'Título editado sintético',
        sections: draft.sections.map(section => ({
          ...section,
          content: '<p>Contenido sintético</p>',
        })),
      };
      expect(shape(restoreClinicalDocumentDraftTemplate(edited))).toEqual(shape(draft));
      expect(
        shape(
          restoreClinicalDocumentDraftTemplate(
            createDraft(id === 'otro' ? 'epicrisis' : 'otro'),
            id,
            true
          )
        )
      ).toEqual(shape(draft));
      const saved = structuredClone(edited);
      expect(shape(hydrateClinicalDocumentWorkspaceRecord(saved))).toMatchSnapshot(
        'saved hydration'
      );
    });
  }
});
