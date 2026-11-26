// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';
import {
  executeClinicalDocumentTemplateRestore,
  handleClinicalDocumentTemplateSelection,
  toggleClinicalDocumentAnnex,
} from '@/features/clinical-documents/controllers/clinicalDocumentsWorkspaceActionController';

const buildDraft = (_annexContent: string | null = null) =>
  createClinicalDocumentDraft({
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
  });

describe('clinicalDocumentsWorkspaceActionController', () => {
  it('updates template selection without mutating the open draft', () => {
    const setSelectedTemplateId = vi.fn();

    handleClinicalDocumentTemplateSelection({
      templateId: 'evolucion',
      setSelectedTemplateId,
    });

    expect(setSelectedTemplateId).toHaveBeenCalledWith('evolucion');

    handleClinicalDocumentTemplateSelection({
      templateId: 'epicrisis',
      setSelectedTemplateId,
    });

    expect(setSelectedTemplateId).toHaveBeenLastCalledWith('epicrisis');
  });

  it('restores the template only after confirmation', async () => {
    const restoreTemplateContent = vi.fn();
    const info = vi.fn();

    await executeClinicalDocumentTemplateRestore({
      draft: buildDraft(),
      canEdit: true,
      confirm: vi.fn().mockResolvedValue(true),
      restoreTemplateContent,
      info,
    });

    expect(restoreTemplateContent).toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      'Plantilla reestablecida',
      'El documento volvió a su estructura base y quedó listo para seguir editando.'
    );
  });

  it('creates annex content only when missing and always requests scroll for editable drafts', () => {
    const patchAnnexContent = vi.fn();
    const scrollToAnnex = vi.fn();

    toggleClinicalDocumentAnnex({
      draft: buildDraft(),
      canEdit: true,
      patchAnnexContent,
      scrollToAnnex,
    });

    expect(patchAnnexContent).toHaveBeenCalledWith('<br>');
    expect(scrollToAnnex).toHaveBeenCalledTimes(1);

    patchAnnexContent.mockClear();
    scrollToAnnex.mockClear();

    const draftWithAnnex = buildDraft();
    draftWithAnnex.annexContent = '<p>Ya existe</p>';

    toggleClinicalDocumentAnnex({
      draft: draftWithAnnex,
      canEdit: true,
      patchAnnexContent,
      scrollToAnnex,
    });

    expect(patchAnnexContent).not.toHaveBeenCalled();
    expect(scrollToAnnex).toHaveBeenCalledTimes(1);
  });
});
