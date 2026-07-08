import { describe, expect, it } from 'vitest';

import {
  buildRestoreClinicalDocumentTemplateConfirmOptions,
  canApplyClinicalDocumentTemplateSelection,
  canDeleteClinicalDocumentFromWorkspace,
  mergeDraftIntoClinicalDocumentsSidebar,
  resolveClinicalDocumentsWorkspaceAccessState,
} from '@/features/clinical-documents/hooks/clinicalDocumentsWorkspaceModelSupport';
import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';

const patient = {
  patientName: 'Paciente Test',
  rut: '11.111.111-1',
  specialty: 'Medicina',
};

const buildDocument = (id: string, isLocked = false) => ({
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
  id,
  isLocked,
});

describe('clinicalDocumentsWorkspaceModelSupport', () => {
  it('resolves access state consistently for viewer and admin on closed episodes', () => {
    expect(resolveClinicalDocumentsWorkspaceAccessState(patient as never, 'viewer')).toMatchObject({
      canRead: false,
      canEdit: false,
      canDelete: false,
      persistReason: 'autosave',
    });

    expect(
      resolveClinicalDocumentsWorkspaceAccessState(
        { ...patient, transferDate: '2026-03-10' } as never,
        'admin'
      )
    ).toMatchObject({
      canRead: true,
      canEdit: true,
      canDelete: true,
      persistReason: 'admin_fix',
    });
  });

  it('lets specialists edit drafts while routing delete through the document guard', () => {
    expect(
      resolveClinicalDocumentsWorkspaceAccessState(patient as never, 'doctor_specialist')
    ).toMatchObject({
      canRead: true,
      canEdit: true,
      canDelete: false,
      canDeleteByRole: false,
      canMutateEpisode: true,
    });
  });

  it('keeps nurses in visualization mode for clinical documents', () => {
    expect(
      resolveClinicalDocumentsWorkspaceAccessState(patient as never, 'nurse_hospital')
    ).toMatchObject({
      canRead: true,
      canEdit: false,
      canDelete: false,
      canDeleteByRole: false,
      canMutateEpisode: true,
    });
  });

  it('merges the draft into sidebar documents without changing unrelated entries', () => {
    const primary = buildDocument('primary');
    const secondary = buildDocument('secondary');
    const merged = mergeDraftIntoClinicalDocumentsSidebar([primary, secondary], {
      ...secondary,
      title: 'Actualizado',
    });

    expect(merged[0].title).toBe(primary.title);
    expect(merged[1].title).toBe('Actualizado');
  });

  it('allows template actions only when the draft is editable and unlocked', () => {
    expect(
      canApplyClinicalDocumentTemplateSelection({ draft: buildDocument('doc-1'), canEdit: true })
    ).toBe(true);
    expect(
      canApplyClinicalDocumentTemplateSelection({
        draft: buildDocument('doc-2', true),
        canEdit: true,
      })
    ).toBe(false);
    expect(canApplyClinicalDocumentTemplateSelection({ draft: null, canEdit: true })).toBe(false);
  });

  it('allows the document author to delete their own active unlocked document', () => {
    const ownedDocument = {
      ...buildDocument('doc-owned'),
      isActiveEpisodeDocument: true,
      isLocked: false,
    };

    expect(
      canDeleteClinicalDocumentFromWorkspace({
        document: ownedDocument,
        canDeleteByRole: false,
        canMutateEpisode: true,
        role: 'doctor_urgency',
        user: { uid: 'u1', email: 'doctor@test.com' },
      })
    ).toBe(true);

    expect(
      canDeleteClinicalDocumentFromWorkspace({
        document: { ...ownedDocument, isLocked: true },
        canDeleteByRole: false,
        canMutateEpisode: true,
        role: 'doctor_urgency',
        user: { uid: 'u1', email: 'doctor@test.com' },
      })
    ).toBe(false);

    expect(
      canDeleteClinicalDocumentFromWorkspace({
        document: ownedDocument,
        canDeleteByRole: false,
        canMutateEpisode: true,
        role: 'doctor_urgency',
        user: { uid: 'other-user', email: 'other@test.com' },
      })
    ).toBe(false);

    expect(
      canDeleteClinicalDocumentFromWorkspace({
        document: ownedDocument,
        canDeleteByRole: false,
        canMutateEpisode: true,
        role: 'nurse_hospital',
        user: { uid: 'u1', email: 'doctor@test.com' },
      })
    ).toBe(false);
  });

  it('builds a stable restore-template confirmation payload', () => {
    expect(buildRestoreClinicalDocumentTemplateConfirmOptions()).toEqual({
      title: 'Reestablecer plantilla del documento',
      message:
        'Se restaurarán el título, las etiquetas y las secciones base de la plantilla. El contenido clínico editable actual se reemplazará por la estructura original del documento.',
      confirmText: 'Reestablecer',
      cancelText: 'Cancelar',
      variant: 'warning',
    });
  });
});
