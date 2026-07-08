import { act, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import type { ClipboardEvent, KeyboardEvent, MutableRefObject } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useClinicalDocumentRichTextEditorController } from '@/features/clinical-documents/hooks/useClinicalDocumentRichTextEditorController';
import { CLINICAL_DOCUMENT_MAX_INLINE_IMAGE_BYTES } from '@/features/clinical-documents/controllers/clinicalDocumentPasteController';
import type { ClinicalDocumentRichTextEditorActivationApi } from '@/features/clinical-documents/hooks/clinicalDocumentRichTextEditorTypes';

const applyEditorCommandMock = vi.fn();
const normalizeContentMock = vi.fn((value: string) => value.trim());

vi.mock('@/features/clinical-documents/controllers/clinicalDocumentRichTextController', () => ({
  applyClinicalDocumentEditorCommand: (command: string, value?: string) =>
    applyEditorCommandMock(command, value),
  normalizeClinicalDocumentContentForStorage: (value: string) => normalizeContentMock(value),
}));

describe('useClinicalDocumentRichTextEditorController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('notifies activation, input changes, and deactivation with editor history state', () => {
    const editorRef = createRef<HTMLDivElement>() as MutableRefObject<HTMLDivElement | null>;
    const onChange = vi.fn();
    const onActivate = vi.fn();
    const onDeactivate = vi.fn();
    const editor = document.createElement('div');
    editor.innerHTML = 'Inicial';
    editorRef.current = editor;

    const { result } = renderHook(() =>
      useClinicalDocumentRichTextEditorController({
        sectionId: 'section-1',
        value: 'Inicial',
        disabled: false,
        editorRef,
        onChange,
        onActivate,
        onDeactivate,
      })
    );

    act(() => {
      result.current.handleActivateInteraction();
    });

    expect(onActivate).toHaveBeenCalledWith(
      'section-1',
      expect.objectContaining({ element: editor, canUndo: false, canRedo: false })
    );

    editor.innerHTML = 'Actualizado';
    act(() => {
      result.current.handleInput();
    });

    expect(onChange).toHaveBeenCalledWith('Actualizado');

    act(() => {
      result.current.handleBlur();
    });

    expect(onDeactivate).toHaveBeenCalledWith('section-1');
  });

  it('maps keyboard shortcuts to editor commands and ignores input when disabled', () => {
    const editorRef = createRef<HTMLDivElement>() as MutableRefObject<HTMLDivElement | null>;
    const editor = document.createElement('div');
    editorRef.current = editor;
    const onChange = vi.fn();

    const { result, rerender } = renderHook(
      ({ disabled }) =>
        useClinicalDocumentRichTextEditorController({
          sectionId: 'section-1',
          value: 'Texto',
          disabled,
          editorRef,
          onChange,
        }),
      { initialProps: { disabled: false } }
    );

    act(() => {
      result.current.handleKeyDown({
        key: 'b',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent<HTMLDivElement>);
      result.current.handleKeyDown({
        key: 'Tab',
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent<HTMLDivElement>);
    });

    expect(applyEditorCommandMock).toHaveBeenCalledWith('bold', undefined);
    expect(applyEditorCommandMock).toHaveBeenCalledWith('outdent', undefined);

    rerender({ disabled: true });
    act(() => {
      result.current.handleKeyDown({
        key: 'i',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent<HTMLDivElement>);
    });

    expect(applyEditorCommandMock).toHaveBeenCalledTimes(2);
  });

  it('defers external content sync while focused and applies it on blur', () => {
    const editorRef = createRef<HTMLDivElement>() as MutableRefObject<HTMLDivElement | null>;
    const editor = document.createElement('div');
    editor.innerHTML = 'Inicial';
    editorRef.current = editor;
    const onChange = vi.fn();

    const activeElementSpy = vi.spyOn(document, 'activeElement', 'get');

    const { result, rerender } = renderHook(
      ({ value }) =>
        useClinicalDocumentRichTextEditorController({
          sectionId: 'section-1',
          value,
          disabled: false,
          editorRef,
          onChange,
        }),
      { initialProps: { value: 'Inicial' } }
    );

    activeElementSpy.mockReturnValue(editor);
    rerender({ value: 'Actualizado externamente' });

    expect(editor.innerHTML).toBe('Inicial');

    activeElementSpy.mockReturnValue(document.body);
    act(() => {
      result.current.handleBlur();
    });

    expect(editor.innerHTML).toBe('Actualizado externamente');

    activeElementSpy.mockRestore();
  });

  it('does not overwrite a local edit with a stale external value on blur', () => {
    const editorRef = createRef<HTMLDivElement>() as MutableRefObject<HTMLDivElement | null>;
    const editor = document.createElement('div');
    editor.innerHTML = 'Plan generado por IA';
    editorRef.current = editor;
    const onChange = vi.fn();

    const activeElementSpy = vi.spyOn(document, 'activeElement', 'get');

    const { result, rerender } = renderHook(
      ({ value }) =>
        useClinicalDocumentRichTextEditorController({
          sectionId: 'section-1',
          value,
          disabled: false,
          editorRef,
          onChange,
        }),
      { initialProps: { value: 'Plan generado por IA' } }
    );

    activeElementSpy.mockReturnValue(editor);
    editor.innerHTML = 'Plan editado por medico';
    act(() => {
      result.current.handleInput();
    });

    rerender({ value: 'Plan generado por IA actualizado externamente' });

    activeElementSpy.mockReturnValue(document.body);
    act(() => {
      result.current.handleBlur();
    });

    expect(editor.innerHTML).toBe('Plan editado por medico');
    expect(onChange).toHaveBeenLastCalledWith('Plan editado por medico');

    activeElementSpy.mockRestore();
  });

  it('routes insertHtml through the editor activation api and commits a normalized change', () => {
    const editorRef = createRef<HTMLDivElement>() as MutableRefObject<HTMLDivElement | null>;
    const editor = document.createElement('div');
    editor.innerHTML = 'Inicial';
    editorRef.current = editor;
    const onChange = vi.fn();
    const onActivate = vi.fn();

    Object.defineProperty(globalThis.document, 'execCommand', {
      value: vi.fn((command: string, _showUi: boolean, value?: string) => {
        if (command === 'insertHTML') {
          editor.innerHTML = `${editor.innerHTML}${value ?? ''}`;
        }
        return true;
      }),
      configurable: true,
    });

    const { result } = renderHook(() =>
      useClinicalDocumentRichTextEditorController({
        sectionId: 'section-1',
        value: 'Inicial',
        disabled: false,
        editorRef,
        onChange,
        onActivate,
      })
    );

    act(() => {
      result.current.handleActivateInteraction();
    });

    const activationApi = onActivate.mock.calls.at(-1)?.[1];
    expect(activationApi).toBeTruthy();

    act(() => {
      activationApi.insertHtml('<strong> Nuevo</strong>');
    });

    expect(editor.innerHTML).toBe('Inicial<strong> Nuevo</strong>');
    expect(onChange).toHaveBeenLastCalledWith('Inicial<strong> Nuevo</strong>');
  });

  it('commits direct editor DOM mutations through the shared normalization pipeline', () => {
    const editorRef = createRef<HTMLDivElement>() as MutableRefObject<HTMLDivElement | null>;
    const editor = document.createElement('div');
    editor.innerHTML = 'Inicial';
    editorRef.current = editor;
    const onChange = vi.fn();

    const { result } = renderHook(() =>
      useClinicalDocumentRichTextEditorController({
        sectionId: 'section-1',
        value: 'Inicial',
        disabled: false,
        editorRef,
        onChange,
      })
    );

    editor.innerHTML = '  <img src="x"> Actualizado ';

    act(() => {
      result.current.commitEditorDomMutation();
    });

    expect(normalizeContentMock).toHaveBeenCalledWith('  <img src="x"> Actualizado ');
    expect(onChange).toHaveBeenLastCalledWith('<img src="x"> Actualizado');
  });

  it('uploads and inserts a Storage-backed pasted image when it exceeds the inline limit', async () => {
    const editorRef = createRef<HTMLDivElement>() as MutableRefObject<HTMLDivElement | null>;
    const editor = document.createElement('div');
    editor.innerHTML = 'Inicial';
    editorRef.current = editor;
    const onChange = vi.fn();
    const onUploadPastedImage = vi.fn(async () => ({
      attachmentId: 'att_1',
      imageUrl: 'https://storage.test/image.jpg',
      storagePath: 'clinical-attachments/hhr/rut/episode/att_1/image.jpg',
    }));
    const preventDefault = vi.fn();
    const file = new File(
      [new Uint8Array(CLINICAL_DOCUMENT_MAX_INLINE_IMAGE_BYTES + 1)],
      'large.jpg',
      { type: 'image/jpeg' }
    );

    const { result } = renderHook(() =>
      useClinicalDocumentRichTextEditorController({
        sectionId: 'section-1',
        value: 'Inicial',
        disabled: false,
        editorRef,
        onChange,
        onUploadPastedImage,
      })
    );

    await act(async () => {
      result.current.handlePaste({
        preventDefault,
        clipboardData: {
          files: [file],
          getData: () => '',
        },
      } as unknown as ClipboardEvent<HTMLDivElement>);
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(onUploadPastedImage).toHaveBeenCalledWith(file);
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('data-clinical-attachment-id'));
    expect(editor.innerHTML).toContain('https://storage.test/image.jpg');
  });

  it('notifies and skips insertion when a Storage image upload fails', async () => {
    const editorRef = createRef<HTMLDivElement>() as MutableRefObject<HTMLDivElement | null>;
    const editor = document.createElement('div');
    editor.innerHTML = 'Inicial';
    editorRef.current = editor;
    const onChange = vi.fn();
    const onUploadPastedImage = vi.fn(async () => null);
    const onImagePasteRejected = vi.fn();
    const file = new File(
      [new Uint8Array(CLINICAL_DOCUMENT_MAX_INLINE_IMAGE_BYTES + 1)],
      'large.jpg',
      { type: 'image/jpeg' }
    );

    const { result } = renderHook(() =>
      useClinicalDocumentRichTextEditorController({
        sectionId: 'section-1',
        value: 'Inicial',
        disabled: false,
        editorRef,
        onChange,
        onUploadPastedImage,
        onImagePasteRejected,
      })
    );

    await act(async () => {
      result.current.handlePaste({
        preventDefault: vi.fn(),
        clipboardData: {
          files: [file],
          getData: () => '',
        },
      } as unknown as ClipboardEvent<HTMLDivElement>);
    });

    expect(onImagePasteRejected).toHaveBeenCalledWith(expect.stringContaining('No se pudo subir'));
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.innerHTML).toBe('Inicial');
  });

  it('commits the cleaned content when /lab resolves to no labs (no stranded "/lab" in value)', async () => {
    const editorRef = createRef<HTMLDivElement>() as MutableRefObject<HTMLDivElement | null>;
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.textContent = 'Nota /lab ';
    document.body.appendChild(editor);
    editorRef.current = editor;

    // Caret at the end, right after the typed command.
    const textNode = editor.firstChild as Text;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(textNode, (textNode.textContent ?? '').length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    const onChange = vi.fn();
    const onSlashLab = vi.fn().mockResolvedValue(null);

    const { result } = renderHook(() =>
      useClinicalDocumentRichTextEditorController({
        sectionId: 'section-1',
        value: 'Nota /lab ',
        disabled: false,
        editorRef,
        onChange,
        onSlashLab,
      })
    );

    await act(async () => {
      result.current.handleInput();
    });

    expect(onSlashLab).toHaveBeenCalledTimes(1);
    // The cleaned content is propagated even though no labs came back, so the
    // command does not resurface on blur.
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)?.[0]).not.toContain('/lab');
    expect(editor.textContent).not.toContain('/lab');

    editor.remove();
  });

  it('navigates undo/redo through the snapshot buffer', () => {
    const editorRef = createRef<HTMLDivElement>() as MutableRefObject<HTMLDivElement | null>;
    const editor = document.createElement('div');
    editor.innerHTML = 'Inicial';
    editorRef.current = editor;
    const onChange = vi.fn();
    let api: ClinicalDocumentRichTextEditorActivationApi | null = null;

    const { result } = renderHook(() =>
      useClinicalDocumentRichTextEditorController({
        sectionId: 'section-1',
        value: 'Inicial',
        disabled: false,
        editorRef,
        onChange,
        onActivate: (_sectionId, editorApi) => {
          api = editorApi;
        },
      })
    );

    act(() => {
      result.current.handleActivateInteraction();
    });
    expect(api).not.toBeNull();

    // Record a second snapshot, then walk the buffer backward and forward.
    editor.innerHTML = 'Editado';
    act(() => {
      api!.applyCommand('bold');
    });
    expect(onChange).toHaveBeenLastCalledWith('Editado');

    act(() => {
      api!.applyCommand('undo');
    });
    expect(editor.innerHTML).toBe('Inicial');
    expect(onChange).toHaveBeenLastCalledWith('Inicial');

    act(() => {
      api!.applyCommand('redo');
    });
    expect(editor.innerHTML).toBe('Editado');
    expect(onChange).toHaveBeenLastCalledWith('Editado');
  });

  it('clears the pending history-debounce timer on unmount (no leak after blur-less unmount)', () => {
    vi.useFakeTimers();
    try {
      const editorRef = createRef<HTMLDivElement>() as MutableRefObject<HTMLDivElement | null>;
      const editor = document.createElement('div');
      editor.innerHTML = 'Inicial';
      editorRef.current = editor;

      const { result, unmount } = renderHook(() =>
        useClinicalDocumentRichTextEditorController({
          sectionId: 'section-1',
          value: 'Inicial',
          disabled: false,
          editorRef,
          onChange: vi.fn(),
        })
      );

      act(() => {
        result.current.handleActivateInteraction();
      });

      // Typing schedules a debounced history snapshot (500ms timer).
      editor.innerHTML = 'Editado';
      act(() => {
        result.current.handleInput();
      });
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      // Switching documents unmounts the editor WITHOUT a blur; the cleanup
      // must clear the pending timer so it cannot fire after unmount.
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
