import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';
import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';
import { useClinicalDocumentWorkspaceDraft } from '@/features/clinical-documents/hooks/useClinicalDocumentWorkspaceDraft';

const executePersistClinicalDocumentEditorDraft = vi.fn();
const resolveClinicalDocumentAutosaveCommit = vi.fn();
const recordOperationalOutcome = vi.fn();
const recordOperationalTelemetry = vi.fn();

vi.mock('@/application/clinical-documents/clinicalDocumentEditorUseCases', async importOriginal => {
  const actual =
    await importOriginal<
      typeof import('@/application/clinical-documents/clinicalDocumentEditorUseCases')
    >();

  return {
    ...actual,
    executePersistClinicalDocumentEditorDraft: (...args: unknown[]) =>
      executePersistClinicalDocumentEditorDraft(...args),
    resolveClinicalDocumentAutosaveCommit: (...args: unknown[]) =>
      resolveClinicalDocumentAutosaveCommit(...args),
  };
});

vi.mock('@/services/observability/operationalTelemetryService', () => ({
  recordOperationalOutcome: (...args: unknown[]) => recordOperationalOutcome(...args),
  recordOperationalTelemetry: (...args: unknown[]) => recordOperationalTelemetry(...args),
}));

const buildDraft = (id: string, content: string): ClinicalDocumentRecord => {
  const draft = createClinicalDocumentDraft({
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

  draft.id = id;
  draft.sections = draft.sections.map(section =>
    section.id === 'antecedentes' ? { ...section, content } : section
  );

  return draft;
};

describe('useClinicalDocumentWorkspaceDraft autosave integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resolveClinicalDocumentAutosaveCommit.mockReturnValue('mark_clean');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes pending structural formatting when switching to another document before debounce', async () => {
    const firstDraft = buildDraft(
      'doc-1',
      '<p style="margin-left: 24px;">Documento uno con sangría</p>'
    );
    const secondDraft = buildDraft('doc-2', '<p>Documento dos</p>');

    executePersistClinicalDocumentEditorDraft.mockResolvedValue({
      status: 'success',
      data: firstDraft,
      issues: [],
    });

    const { result, rerender } = renderHook(
      ({ documents, selectedDocumentId }) =>
        useClinicalDocumentWorkspaceDraft({
          documents,
          selectedDocumentId,
          canEdit: true,
          isActive: true,
          hospitalId: 'hhr',
          role: 'doctor_urgency',
          persistReason: 'autosave',
          user: {
            uid: 'u1',
            email: 'doctor@test.com',
            displayName: 'Doctor Test',
          },
        }),
      {
        initialProps: {
          documents: [firstDraft],
          selectedDocumentId: firstDraft.id,
        },
      }
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.draft?.id).toBe(firstDraft.id);

    act(() => {
      result.current.patchSection(
        'antecedentes',
        '<p style="margin-left: 48px;">Documento uno con doble sangría</p>'
      );
    });

    await act(async () => {
      rerender({
        documents: [firstDraft, secondDraft],
        selectedDocumentId: secondDraft.id,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(executePersistClinicalDocumentEditorDraft).toHaveBeenCalledTimes(1);
    expect(executePersistClinicalDocumentEditorDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        record: expect.objectContaining({
          id: firstDraft.id,
          sections: expect.arrayContaining([
            expect.objectContaining({
              id: 'antecedentes',
              content: expect.stringContaining('margin-left: 48px'),
            }),
          ]),
        }),
      })
    );
    expect(result.current.draft?.id).toBe(secondDraft.id);
  });

  it('does not let a completed autosave from the previous document mark the current document clean', async () => {
    const firstDraft = buildDraft('doc-1', '<p>Documento uno original</p>');
    const secondDraft = buildDraft('doc-2', '<p>Documento dos original</p>');
    let resolveFirstAutosave: (value: {
      status: 'success';
      data: ClinicalDocumentRecord;
      issues: [];
    }) => void = () => undefined;

    executePersistClinicalDocumentEditorDraft.mockReturnValueOnce(
      new Promise(resolve => {
        resolveFirstAutosave = resolve;
      })
    );

    const { result, rerender } = renderHook(
      ({ documents, selectedDocumentId }) =>
        useClinicalDocumentWorkspaceDraft({
          documents,
          selectedDocumentId,
          canEdit: true,
          isActive: true,
          hospitalId: 'hhr',
          role: 'doctor_urgency',
          persistReason: 'autosave',
          user: {
            uid: 'u1',
            email: 'doctor@test.com',
            displayName: 'Doctor Test',
          },
        }),
      {
        initialProps: {
          documents: [firstDraft],
          selectedDocumentId: firstDraft.id,
        },
      }
    );

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.patchSection('antecedentes', '<p>Documento uno pendiente</p>');
    });

    await act(async () => {
      rerender({
        documents: [firstDraft, secondDraft],
        selectedDocumentId: secondDraft.id,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      result.current.patchSection('antecedentes', '<p>Documento dos pendiente</p>');
    });

    await act(async () => {
      resolveFirstAutosave({
        status: 'success',
        data: {
          ...firstDraft,
          sections: firstDraft.sections.map(section =>
            section.id === 'antecedentes'
              ? { ...section, content: '<p>Documento uno pendiente</p>' }
              : section
          ),
        },
        issues: [],
      });
      await Promise.resolve();
    });

    expect(result.current.draft?.id).toBe(secondDraft.id);
    expect(result.current.draft?.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'antecedentes',
          content: '<p>Documento dos pendiente</p>',
        }),
      ])
    );
    expect(result.current.hasLocalDraftChanges).toBe(true);
  });
});
