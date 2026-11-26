// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';
import type { ClinicalDocumentDraftBaseState } from '@/features/clinical-documents/hooks/clinicalDocumentDraftReducer';
import {
  resolveClinicalDocumentAutosaveCommit,
  resolveClinicalDocumentDraftLoad,
} from '@/features/clinical-documents/use-cases/clinicalDocumentEditorUseCases';
import { executeOpenClinicalDocumentPrint } from '@/features/clinical-documents/use-cases/clinicalDocumentPrintOpenUseCase';
import { openClinicalDocumentBrowserPrintPreview } from '@/features/clinical-documents/services/clinicalDocumentBrowserPrintService';

vi.mock('@/features/clinical-documents/services/clinicalDocumentBrowserPrintService', () => ({
  openClinicalDocumentBrowserPrintPreview: vi.fn(async () => true),
}));

const buildRecord = () =>
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
      specialty: 'Cirugía',
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
    especialidad: 'Cirugía',
  });

const emptyBaseState: ClinicalDocumentDraftBaseState = {
  document: null,
  snapshot: '',
  updatedAt: '',
};

describe('clinicalDocumentEditorUseCases', () => {
  it('stages a remote version when a dirty draft receives a newer update', () => {
    const current = buildRecord();
    const remote = {
      ...buildRecord(),
      id: current.id,
      audit: {
        ...current.audit,
        updatedAt: '2026-03-06T14:00:00.000Z',
      },
    };

    const resolution = resolveClinicalDocumentDraftLoad({
      documents: [remote],
      selectedDocumentId: current.id,
      currentDraft: current,
      baseState: {
        document: current,
        snapshot: JSON.stringify(current),
        updatedAt: current.audit.updatedAt,
      },
      hasLocalDraftChanges: true,
    });

    expect(resolution.kind).toBe('stage_remote');
  });

  it('loads the selected document when there are no local conflicts', () => {
    const current = buildRecord();

    const resolution = resolveClinicalDocumentDraftLoad({
      documents: [current],
      selectedDocumentId: current.id,
      currentDraft: null,
      baseState: emptyBaseState,
      hasLocalDraftChanges: false,
    });

    expect(resolution.kind).toBe('load');
  });

  it('preserves the current draft when the selected remote document disappears transiently', () => {
    const current = buildRecord();

    const resolution = resolveClinicalDocumentDraftLoad({
      documents: [],
      selectedDocumentId: current.id,
      currentDraft: current,
      baseState: {
        document: current,
        snapshot: JSON.stringify(current),
        updatedAt: current.audit.updatedAt,
      },
      hasLocalDraftChanges: true,
    });

    expect(resolution.kind).toBe('preserve');
  });

  it('preserves local draft changes when the selected remote document is unchanged', () => {
    const current = buildRecord();
    const remote = {
      ...buildRecord(),
      id: current.id,
      audit: {
        ...current.audit,
        updatedAt: current.audit.updatedAt,
      },
    };

    const resolution = resolveClinicalDocumentDraftLoad({
      documents: [remote],
      selectedDocumentId: current.id,
      currentDraft: {
        ...current,
        sections: current.sections.map(section =>
          section.id === 'historia_actual'
            ? { ...section, content: 'Cambio local pendiente' }
            : section
        ),
      },
      baseState: {
        document: current,
        snapshot: JSON.stringify(current),
        updatedAt: current.audit.updatedAt,
      },
      hasLocalDraftChanges: true,
    });

    expect(resolution.kind).toBe('preserve');
  });

  it('marks autosave as clean only when the current draft still matches the requested snapshot', () => {
    expect(
      resolveClinicalDocumentAutosaveCommit({
        requestedSnapshot: 'snapshot-a',
        currentDraftSnapshot: 'snapshot-a',
      })
    ).toBe('mark_clean');

    expect(
      resolveClinicalDocumentAutosaveCommit({
        requestedSnapshot: 'snapshot-a',
        currentDraftSnapshot: 'snapshot-b',
      })
    ).toBe('commit_base');
  });

  it('delegates browser print opening through the print use case', async () => {
    const record = buildRecord();

    await expect(executeOpenClinicalDocumentPrint(record)).resolves.toBe(true);
  });

  it('forwards annex-only print requests through the print use case contract', async () => {
    const record = buildRecord();

    await expect(
      executeOpenClinicalDocumentPrint(record, { annexMode: 'annex_only' })
    ).resolves.toBe(true);

    expect(openClinicalDocumentBrowserPrintPreview).toHaveBeenCalledWith(
      record.title,
      record.documentType,
      record.ieehDraft,
      {
        annexMode: 'annex_only',
        includePatientSignature: true,
      }
    );
  });

  it('forwards patient signature suppression through the print use case contract', async () => {
    const record = { ...buildRecord(), includePatientSignature: false };

    await expect(executeOpenClinicalDocumentPrint(record)).resolves.toBe(true);

    expect(openClinicalDocumentBrowserPrintPreview).toHaveBeenCalledWith(
      record.title,
      record.documentType,
      record.ieehDraft,
      {
        annexMode: undefined,
        includePatientSignature: false,
      }
    );
  });
});
