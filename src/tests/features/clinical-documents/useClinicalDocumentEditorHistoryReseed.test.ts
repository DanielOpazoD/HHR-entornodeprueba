import { act, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import type { MutableRefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useClinicalDocumentRichTextEditorController } from '@/features/clinical-documents/hooks/useClinicalDocumentRichTextEditorController';
import type { ClinicalDocumentRichTextEditorActivationApi } from '@/features/clinical-documents/hooks/clinicalDocumentRichTextEditorTypes';

describe('clinical document editor — external history replacement', () => {
  it.each([0, 500])(
    'discards a pending local snapshot after external replacement (%i ms)',
    delay => {
      vi.useFakeTimers();
      try {
        const editorRef = createRef<HTMLDivElement>() as MutableRefObject<HTMLDivElement | null>;
        const editor = document.createElement('div');
        editorRef.current = editor;
        let api: ClinicalDocumentRichTextEditorActivationApi | null = null;
        const onChange = vi.fn();
        const { result, rerender } = renderHook(
          ({ value }) =>
            useClinicalDocumentRichTextEditorController({
              sectionId: 'section-1',
              value,
              disabled: false,
              editorRef,
              onChange,
              onActivate: (_sectionId, editorApi) => {
                api = editorApi;
              },
            }),
          { initialProps: { value: 'Inicial' } }
        );
        act(() => {
          result.current.handleActivateInteraction();
        });
        editor.innerHTML = 'Edición pendiente';
        act(() => {
          result.current.handleInput();
        });
        rerender({ value: 'Contenido externo' });
        expect(editor.innerHTML).toBe('Contenido externo');
        act(() => {
          vi.advanceTimersByTime(delay);
        });
        expect(api!.canUndo).toBe(false);
        act(() => {
          api!.applyCommand('undo');
          api!.applyCommand('redo');
        });
        expect(editor.innerHTML).toBe('Contenido externo');
        editor.innerHTML = 'Edición vigente';
        act(() => {
          result.current.handleInput();
          vi.advanceTimersByTime(500);
        });
        act(() => {
          api!.applyCommand('undo');
        });
        expect(editor.innerHTML).toBe('Contenido externo');
        act(() => {
          api!.applyCommand('redo');
        });
        expect(editor.innerHTML).toBe('Edición vigente');
      } finally {
        vi.useRealTimers();
      }
    }
  );
});
