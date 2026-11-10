import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { firestoreDb } from '@/services/storage/firestore';
import { ClinicalDocumentTemplateRepository } from '@/services/repositories/ClinicalDocumentTemplateRepository';
import { useClinicalDocumentWorkspaceBootstrap } from '@/features/clinical-documents/hooks/useClinicalDocumentWorkspaceBootstrap';
import {
  createClinicalDocumentDraft,
  restoreClinicalDocumentDraftTemplate,
} from '@/features/clinical-documents/domain/factories';
import { hydrateClinicalDocumentWorkspaceRecord } from '@/features/clinical-documents/controllers/clinicalDocumentWorkspaceController';
import { buildDocument, patient } from './useClinicalDocumentWorkspaceBootstrap.fixtures';

vi.mock('@/services/storage/firestore', () => ({
  firestoreDb: { getDocs: vi.fn(), runBatch: vi.fn(), setDoc: vi.fn() },
}));
vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => true }));
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
const localOptions = loadedOptions.filter(([id]) => id !== 'epicrisis_traslado');
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
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(firestoreDb.getDocs).mockReset().mockResolvedValue([]);
  });

  it('offers four options while the remote read is pending, then five for an empty collection', async () => {
    let finish: () => void = () => undefined;
    vi.mocked(firestoreDb.getDocs).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = () => resolve([]);
        })
    );
    const { result } = renderBootstrap();
    expect(options(result.current.templates)).toEqual(localOptions);
    await act(async () => {
      finish();
    });
    await waitFor(() => expect(options(result.current.templates)).toEqual(loadedOptions));
    expect(firestoreDb.runBatch).not.toHaveBeenCalled();
  });

  it('offers five options when the repository handles a remote read failure', async () => {
    vi.mocked(firestoreDb.getDocs).mockRejectedValueOnce(new Error('synthetic read failure'));
    const { result } = renderBootstrap();
    await waitFor(() => expect(options(result.current.templates)).toEqual(loadedOptions));
  });

  it('offers four options when the application reports a failed catalog load', async () => {
    vi.spyOn(ClinicalDocumentTemplateRepository, 'listActive').mockRejectedValueOnce(
      new Error('synthetic repository failure')
    );
    const { result } = renderBootstrap();
    await act(async () => undefined);
    expect(options(result.current.templates)).toEqual(localOptions);
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
