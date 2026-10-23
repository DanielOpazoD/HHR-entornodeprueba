import { act, fireEvent, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ClinicalDocumentSheetEditorApi } from '@/features/clinical-documents/components/clinicalDocumentSheetShared';
import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';
import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';
import { useClinicalDocumentSheetState } from '@/features/clinical-documents/hooks/useClinicalDocumentSheetState';

const createDocument = (overrides?: { id?: string; specialty?: string; isLocked?: boolean }) =>
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
      episodeKey: `${overrides?.id ?? 'doc-1'}__2026-03-06`,
      admissionDate: '2026-03-06',
      sourceDailyRecordDate: '2026-03-06',
      sourceBedId: 'R1',
      specialty: overrides?.specialty ?? 'Medicina',
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
    especialidad: overrides?.specialty ?? 'Medicina',
  });

const createEditorApi = (history = { canUndo: true, canRedo: false }) => {
  const element = document.createElement('div');
  element.focus = vi.fn();
  return {
    element,
    ...history,
    applyCommand: vi.fn(),
    insertHtml: vi.fn(),
  } satisfies ClinicalDocumentSheetEditorApi;
};

describe('useClinicalDocumentSheetState', () => {
  it('resets document-scoped UI state when the selected document changes', () => {
    const firstDocument = createDocument({ id: 'doc-1', specialty: 'Medicina' });
    const secondDocument = {
      ...createDocument({ id: 'doc-2', specialty: 'Pediatría' }),
      id: 'doc-2',
    };

    const { result, rerender } = renderHook(
      ({ selectedDocument }) => useClinicalDocumentSheetState(selectedDocument),
      {
        initialProps: { selectedDocument: firstDocument },
      }
    );

    act(() => {
      result.current.setIsIndicationsPanelOpen(true);
      result.current.setActivePlanSubsectionId('control_clinico');
      result.current.setActiveIndicationsSpecialtyId('cirugia');
    });

    expect(result.current.isIndicationsPanelOpen).toBe(true);
    expect(result.current.activePlanSubsectionId).toBe('control_clinico');
    expect(result.current.activeIndicationsSpecialtyId).toBe('cirugia');

    rerender({ selectedDocument: secondDocument });

    expect(result.current.isIndicationsPanelOpen).toBe(false);
    expect(result.current.activePlanSubsectionId).toBe('generales');
    expect(result.current.activeIndicationsSpecialtyId).not.toBe('cirugia');
    expect(result.current.activeIndicationsSpecialtyId).toBe('pediatria');
  });

  it('routes formatting and html insertion through the active and last active editor', () => {
    const selectedDocument = createDocument();
    const focus = vi.fn();
    const applyCommand = vi.fn();
    const insertHtml = vi.fn();
    const editorElement = document.createElement('div');

    editorElement.focus = focus;

    const editorApi: ClinicalDocumentSheetEditorApi = {
      element: editorElement,
      canUndo: true,
      canRedo: false,
      applyCommand,
      insertHtml,
    };

    const { result } = renderHook(() => useClinicalDocumentSheetState(selectedDocument));

    expect(result.current.formattingDisabled).toBe(true);

    act(() => {
      result.current.handleEditorActivate('section-1', editorApi);
    });

    expect(result.current.formattingDisabled).toBe(false);
    expect(result.current.activeEditorSectionId).toBe('section-1');
    expect(result.current.activeEditorHistoryState).toEqual({ canUndo: true, canRedo: false });

    act(() => {
      result.current.applyFormatting('bold');
      result.current.insertHtml('<p>Hola</p>');
      result.current.handleEditorDeactivate('section-1');
      result.current.applyFormatting('undo');
      expect(result.current.insertHtml('<p>Después de perder el foco</p>')).toBe(true);
    });

    expect(focus).toHaveBeenCalledTimes(4);
    expect(applyCommand).toHaveBeenNthCalledWith(1, 'bold', undefined);
    expect(applyCommand).toHaveBeenNthCalledWith(2, 'undo', undefined);
    expect(insertHtml).toHaveBeenCalledWith('<p>Hola</p>');
    expect(insertHtml).toHaveBeenCalledWith('<p>Después de perder el foco</p>');
    expect(result.current.activeEditorSectionId).toBeNull();
    expect(result.current.activeEditorHistoryState).toEqual({ canUndo: true, canRedo: false });
  });

  it('drops the previous document editor and history before rendering another document', () => {
    const firstDocument = createDocument();
    const secondDocument = { ...createDocument(), id: 'doc-2' };
    const editorApi: ClinicalDocumentSheetEditorApi = {
      element: document.createElement('div'),
      canUndo: true,
      canRedo: true,
      applyCommand: vi.fn(),
      insertHtml: vi.fn(),
    };
    const nextDocumentStates: Array<{
      activeEditorSectionId: string | null;
      activeEditorHistoryState: { canUndo: boolean; canRedo: boolean };
    }> = [];
    const { result, rerender } = renderHook(
      ({ selectedDocument }) => {
        const state = useClinicalDocumentSheetState(selectedDocument);
        if (selectedDocument.id === secondDocument.id) {
          nextDocumentStates.push({
            activeEditorSectionId: state.activeEditorSectionId,
            activeEditorHistoryState: state.activeEditorHistoryState,
          });
        }
        return state;
      },
      { initialProps: { selectedDocument: firstDocument } }
    );

    act(() => result.current.handleEditorActivate('section-1', editorApi));
    rerender({ selectedDocument: secondDocument });

    expect(nextDocumentStates).toEqual([
      {
        activeEditorSectionId: null,
        activeEditorHistoryState: { canUndo: false, canRedo: false },
      },
    ]);
    act(() => {
      expect(result.current.insertHtml('<p>Segundo documento</p>')).toBe(false);
      result.current.applyFormatting('undo');
      result.current.applyFormatting('redo');
    });
    expect(editorApi.applyCommand).not.toHaveBeenCalled();
    expect(editorApi.insertHtml).not.toHaveBeenCalled();
  });

  it('ignores callbacks captured by a previous document after the new editor activates', () => {
    const firstDocument = createDocument();
    const secondDocument = { ...firstDocument, id: 'doc-2' };
    const firstEditor = createEditorApi();
    const secondEditor = createEditorApi({ canUndo: false, canRedo: true });
    const { result, rerender } = renderHook(
      ({ selectedDocument }) => useClinicalDocumentSheetState(selectedDocument),
      { initialProps: { selectedDocument: firstDocument } }
    );
    act(() => result.current.handleEditorActivate('section-1', firstEditor));
    const previousDocumentHandlers = result.current;
    rerender({ selectedDocument: secondDocument });
    act(() => result.current.handleEditorActivate('section-1', secondEditor));

    act(() => {
      previousDocumentHandlers.handleEditorActivate('section-1', firstEditor);
      previousDocumentHandlers.handleEditorDeactivate('section-1');
      previousDocumentHandlers.applyFormatting('bold');
      previousDocumentHandlers.applyFormatting('undo');
      expect(previousDocumentHandlers.insertHtml('<p>Anterior</p>')).toBe(false);
    });

    expect(result.current.activeEditorSectionId).toBe('section-1');
    expect(result.current.activeEditorHistoryState).toEqual({ canUndo: false, canRedo: true });
    act(() => {
      expect(result.current.insertHtml('<p>Actual</p>')).toBe(true);
      result.current.applyFormatting('redo');
    });
    expect(firstEditor.element.focus).not.toHaveBeenCalled();
    expect(firstEditor.applyCommand).not.toHaveBeenCalled();
    expect(firstEditor.insertHtml).not.toHaveBeenCalled();
    expect(secondEditor.insertHtml).toHaveBeenCalledWith('<p>Actual</p>');
    expect(secondEditor.applyCommand).toHaveBeenCalledExactlyOnceWith('redo', undefined);
  });

  it('requires a new editor activation when returning to an earlier document', () => {
    const firstDocument = createDocument();
    const secondDocument = { ...firstDocument, id: 'doc-2' };
    const editorApi = createEditorApi();
    const { result, rerender } = renderHook(
      ({ selectedDocument }) => useClinicalDocumentSheetState(selectedDocument),
      { initialProps: { selectedDocument: firstDocument } }
    );
    act(() => {
      result.current.handleEditorActivate('section-1', editorApi);
      result.current.handleEditorDeactivate('section-1');
    });
    const previousDocumentHandlers = result.current;
    rerender({ selectedDocument: secondDocument });
    rerender({ selectedDocument: firstDocument });

    act(() => {
      previousDocumentHandlers.handleEditorActivate('section-1', editorApi);
      previousDocumentHandlers.applyFormatting('undo');
      expect(previousDocumentHandlers.insertHtml('<p>Sesión anterior</p>')).toBe(false);
      result.current.applyFormatting('undo');
      expect(result.current.insertHtml('<p>Sin editor</p>')).toBe(false);
    });
    expect(result.current.activeEditorSectionId).toBeNull();
    expect(result.current.activeEditorHistoryState).toEqual({ canUndo: false, canRedo: false });
    expect(editorApi.element.focus).not.toHaveBeenCalled();
    expect(editorApi.applyCommand).not.toHaveBeenCalled();
    expect(editorApi.insertHtml).not.toHaveBeenCalled();
  });

  it('keeps the current editor when only the document specialty changes', () => {
    const selectedDocument = createDocument();
    const editorApi = createEditorApi();
    const { result, rerender } = renderHook(
      ({ selectedDocument }) => useClinicalDocumentSheetState(selectedDocument),
      { initialProps: { selectedDocument } }
    );
    act(() => result.current.handleEditorActivate('section-1', editorApi));
    rerender({ selectedDocument: { ...selectedDocument, especialidad: 'Pediatría' } });

    expect(result.current.activeEditorSectionId).toBe('section-1');
    expect(result.current.activeEditorHistoryState).toEqual({ canUndo: true, canRedo: false });
    act(() => {
      expect(result.current.insertHtml('<p>Mismo documento</p>')).toBe(true);
      result.current.applyFormatting('undo');
    });
    expect(editorApi.insertHtml).toHaveBeenCalledWith('<p>Mismo documento</p>');
    expect(editorApi.applyCommand).toHaveBeenCalledExactlyOnceWith('undo', undefined);
  });

  it.each(['locked', 'none'])('blocks editor writes when selection becomes %s', selection => {
    const selectedDocument = createDocument();
    const editorApi = createEditorApi();
    const initialProps: { selectedDocument: ClinicalDocumentRecord | null } = { selectedDocument };
    const { result, rerender } = renderHook(
      ({ selectedDocument }: { selectedDocument: ClinicalDocumentRecord | null }) =>
        useClinicalDocumentSheetState(selectedDocument),
      { initialProps }
    );
    act(() => result.current.handleEditorActivate('section-1', editorApi));
    const previousHandlers = result.current;
    rerender({
      selectedDocument: selection === 'locked' ? { ...selectedDocument, isLocked: true } : null,
    });

    act(() => {
      result.current.handleEditorActivate('section-1', editorApi);
      result.current.applyFormatting('bold');
      result.current.applyFormatting('undo');
      result.current.applyFormatting('redo');
      previousHandlers.applyFormatting('undo');
      expect(result.current.insertHtml('<p>Bloqueado</p>')).toBe(false);
      expect(previousHandlers.insertHtml('<p>Anterior</p>')).toBe(false);
    });
    expect(result.current.formattingDisabled).toBe(true);
    expect(editorApi.element.focus).not.toHaveBeenCalled();
    expect(editorApi.applyCommand).not.toHaveBeenCalled();
    expect(editorApi.insertHtml).not.toHaveBeenCalled();
  });

  it('tracks drag state and ignores drag-over when interaction is disabled', () => {
    const { result } = renderHook(() => useClinicalDocumentSheetState(createDocument()));
    const preventDefault = vi.fn();
    const setData = vi.fn();

    act(() => {
      result.current.sectionDragHandlers.onDragStart(
        {
          dataTransfer: {
            effectAllowed: '',
            setData,
          },
        } as unknown as React.DragEvent<HTMLButtonElement>,
        'section-1'
      );
    });

    expect(result.current.draggedSectionId).toBe('section-1');
    expect(setData).toHaveBeenCalledWith('text/plain', 'section-1');

    act(() => {
      result.current.sectionDragHandlers.onDragOver(
        {
          preventDefault,
        } as unknown as React.DragEvent<HTMLElement>,
        'section-2',
        false
      );
    });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(result.current.dragOverSectionId).toBeNull();

    act(() => {
      result.current.sectionDragHandlers.onDragOver(
        {
          preventDefault,
        } as unknown as React.DragEvent<HTMLElement>,
        'section-2',
        true
      );
      result.current.sectionDragHandlers.onDragLeave('section-2');
      result.current.sectionDragHandlers.onDragEnd();
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(result.current.draggedSectionId).toBeNull();
    expect(result.current.dragOverSectionId).toBeNull();
  });

  it('closes the formatting panel only when double-clicking outside the keep-open surfaces', () => {
    const { result } = renderHook(() => useClinicalDocumentSheetState(createDocument()));
    const keepOpenTarget = document.createElement('div');

    keepOpenTarget.className = 'clinical-document-rich-text-editor';
    document.body.appendChild(keepOpenTarget);

    act(() => {
      result.current.setIsFormattingOpen(true);
    });

    fireEvent.doubleClick(keepOpenTarget);
    expect(result.current.isFormattingOpen).toBe(true);

    fireEvent.doubleClick(document.body);
    expect(result.current.isFormattingOpen).toBe(false);

    keepOpenTarget.remove();
  });
});
