import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ClipboardEvent, KeyboardEvent, MutableRefObject } from 'react';

import {
  buildPastedImageHtml,
  buildPastedStorageImageHtml,
  classifyPasteContent,
  readFileAsDataUrl,
} from '@/features/clinical-documents/controllers/clinicalDocumentPasteController';
import {
  insertClinicalDocumentHtmlAtCursor,
  insertClinicalDocumentPlainTextAtCursor,
  removeTrailingPatternAtCaret,
} from '@/features/clinical-documents/controllers/clinicalDocumentEditorInsertionController';
import {
  applyClinicalDocumentEditorCommand,
  normalizeClinicalDocumentContentForStorage,
} from '@/features/clinical-documents/controllers/clinicalDocumentRichTextController';
import { resolveClinicalDocumentKeyboardShortcut } from '@/features/clinical-documents/controllers/clinicalDocumentRichTextKeyboardController';
import {
  detectSlashCommand,
  removeSlashCommandFromHtml,
  SLASH_LAB_TEXT_REMOVE,
} from '@/features/clinical-documents/controllers/clinicalDocumentSlashCommandController';
import { enforceMandatoryListShape } from '@/features/clinical-documents/controllers/clinicalDocumentMandatoryListShapeController';
import { useClinicalDocumentEditorHistory } from '@/features/clinical-documents/hooks/useClinicalDocumentEditorHistory';
import type { ClinicalDocumentMandatoryListType } from '@/features/clinical-documents/controllers/clinicalDocumentEmptySectionTemplateController';
import type {
  ClinicalDocumentRichTextEditorActivationApi,
  ClinicalDocumentRichTextEditorCommand,
  UploadedClinicalDocumentPastedImage,
} from '@/features/clinical-documents/hooks/clinicalDocumentRichTextEditorTypes';

interface UseClinicalDocumentRichTextEditorControllerParams {
  sectionId: string;
  value: string;
  disabled: boolean;
  editorRef: MutableRefObject<HTMLDivElement | null>;
  /**
   * When set, command application (toolbar/keyboard) re-enforces the list
   * wrapper so list-affecting commands cannot leave the section without its
   * mandatory `<ol>`/`<ul>` shape.
   */
  mandatoryListType?: ClinicalDocumentMandatoryListType | null;
  onChange: (value: string) => void;
  onActivate?: (sectionId: string, editor: ClinicalDocumentRichTextEditorActivationApi) => void;
  onDeactivate?: (sectionId: string) => void;
  onUploadPastedImage?: (file: File) => Promise<UploadedClinicalDocumentPastedImage | null>;
  onImagePasteRejected?: (message: string) => void;
  onSlashLab?: () => Promise<string | null>;
}

export const useClinicalDocumentRichTextEditorController = ({
  sectionId,
  value,
  disabled,
  editorRef,
  mandatoryListType,
  onChange,
  onActivate,
  onDeactivate,
  onUploadPastedImage,
  onImagePasteRejected,
  onSlashLab,
}: UseClinicalDocumentRichTextEditorControllerParams) => {
  const isActiveRef = useRef(false);
  const lastLocalNormalizedValueRef = useRef('');
  const pendingExternalNormalizedValueRef = useRef<string | null>(null);
  const onActivateRef = useRef(onActivate);
  const onDeactivateRef = useRef(onDeactivate);
  const applyEditorCommandRef = useRef<
    ((command: ClinicalDocumentRichTextEditorCommand, value?: string) => void) | null
  >(null);
  const insertHtmlRef = useRef<((html: string) => void) | null>(null);
  const normalizedValue = useMemo(() => normalizeClinicalDocumentContentForStorage(value), [value]);

  // Undo/redo buffer. Driven through stable method callbacks so its internal
  // refs never leak into this hook's dependency arrays.
  const {
    historyState,
    seedHistory,
    navigateHistory,
    consumeApplyingFlag,
    pushHistorySnapshot,
    debouncedPushHistorySnapshot,
    flushPendingHistorySnapshot,
  } = useClinicalDocumentEditorHistory();

  useEffect(() => {
    onActivateRef.current = onActivate;
    onDeactivateRef.current = onDeactivate;
  }, [onActivate, onDeactivate]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const currentNormalizedHtml = normalizeClinicalDocumentContentForStorage(editor.innerHTML);
    const isFocused = typeof document !== 'undefined' && document.activeElement === editor;
    const isLocalEcho = normalizedValue === lastLocalNormalizedValueRef.current;

    if (currentNormalizedHtml !== normalizedValue && !isLocalEcho) {
      if (isFocused) {
        pendingExternalNormalizedValueRef.current = normalizedValue;
      } else {
        editor.innerHTML = normalizedValue;
        pendingExternalNormalizedValueRef.current = null;
      }
    }

    const wasApplyingHistory = consumeApplyingFlag();
    if (!wasApplyingHistory && !isFocused && !isLocalEcho) {
      seedHistory(normalizedValue);
    }
  }, [editorRef, normalizedValue, consumeApplyingFlag, seedHistory]);

  const applyEditorCommand = useCallback(
    (command: ClinicalDocumentRichTextEditorCommand, value?: string) => {
      const editor = editorRef.current;
      if (!editor || disabled) return;

      flushPendingHistorySnapshot();

      if (command === 'undo' || command === 'redo') {
        const snapshot = navigateHistory(command);
        if (snapshot === null) return;
        editor.innerHTML = snapshot;
        lastLocalNormalizedValueRef.current = snapshot;
        onChange(snapshot);
        return;
      }

      editor.focus();
      pendingExternalNormalizedValueRef.current = null;
      applyClinicalDocumentEditorCommand(command, value);
      // List-affecting commands (toggle list, outdent) can strip the mandatory
      // wrapper. Restore it here so the section never persists a broken shape.
      if (mandatoryListType) {
        enforceMandatoryListShape(editor, mandatoryListType);
      }
      const html = normalizeClinicalDocumentContentForStorage(editor.innerHTML);
      lastLocalNormalizedValueRef.current = html;
      pushHistorySnapshot(html);
      onChange(html);
    },
    [
      disabled,
      editorRef,
      flushPendingHistorySnapshot,
      mandatoryListType,
      navigateHistory,
      onChange,
      pushHistorySnapshot,
    ]
  );

  const commitEditorDomMutation = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const html = normalizeClinicalDocumentContentForStorage(editor.innerHTML);
    pendingExternalNormalizedValueRef.current = null;
    lastLocalNormalizedValueRef.current = html;
    pushHistorySnapshot(html);
    onChange(html);
  }, [editorRef, onChange, pushHistorySnapshot]);

  const insertHtml = useCallback(
    (html: string) => {
      const editor = editorRef.current;
      if (!editor || disabled) return;

      flushPendingHistorySnapshot();
      editor.focus();
      pendingExternalNormalizedValueRef.current = null;
      insertClinicalDocumentHtmlAtCursor(editor, html);
      commitEditorDomMutation();
    },
    [commitEditorDomMutation, disabled, editorRef, flushPendingHistorySnapshot]
  );

  const insertPlainText = useCallback(
    (text: string) => {
      const editor = editorRef.current;
      if (!editor || disabled) return;

      flushPendingHistorySnapshot();
      editor.focus();
      pendingExternalNormalizedValueRef.current = null;
      insertClinicalDocumentPlainTextAtCursor(editor, text);
      commitEditorDomMutation();
    },
    [commitEditorDomMutation, disabled, editorRef, flushPendingHistorySnapshot]
  );

  useEffect(() => {
    applyEditorCommandRef.current = applyEditorCommand;
    insertHtmlRef.current = insertHtml;
  }, [applyEditorCommand, insertHtml]);

  const buildActivationApi = useCallback(
    (nextHistory = historyState): ClinicalDocumentRichTextEditorActivationApi => ({
      element: editorRef.current,
      canUndo: nextHistory.canUndo,
      canRedo: nextHistory.canRedo,
      applyCommand: (command, value) => applyEditorCommandRef.current?.(command, value),
      insertHtml: html => insertHtmlRef.current?.(html),
    }),
    [editorRef, historyState]
  );

  const notifyActive = useCallback(
    (nextHistory = historyState) => {
      isActiveRef.current = true;
      onActivateRef.current?.(sectionId, buildActivationApi(nextHistory));
    },
    [buildActivationApi, historyState, sectionId]
  );

  useEffect(() => {
    if (!isActiveRef.current) {
      return;
    }

    onActivateRef.current?.(sectionId, buildActivationApi());
  }, [buildActivationApi, historyState.canRedo, historyState.canUndo, sectionId]);

  const handleInput = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const textContent = editor.textContent || '';
    const command = detectSlashCommand(textContent);

    if (command === 'lab' && onSlashLab) {
      // Strip the typed command at the caret (keeps the cursor in place); fall
      // back to an innerHTML-level strip only if the caret isn't where expected.
      if (!removeTrailingPatternAtCaret(editor, SLASH_LAB_TEXT_REMOVE)) {
        editor.innerHTML = removeSlashCommandFromHtml(editor.innerHTML);
      }

      // Commit the cleaned content NOW so a null lab result can't leave the
      // stranded "/lab " in `value` (which would otherwise resurface on blur).
      const cleanedHtml = normalizeClinicalDocumentContentForStorage(editor.innerHTML);
      pendingExternalNormalizedValueRef.current = null;
      lastLocalNormalizedValueRef.current = cleanedHtml;
      debouncedPushHistorySnapshot(cleanedHtml);
      onChange(cleanedHtml);

      void onSlashLab().then(labText => {
        if (!labText) return;
        insertPlainText(labText);
      });
      return;
    }

    const html = normalizeClinicalDocumentContentForStorage(editor.innerHTML);
    pendingExternalNormalizedValueRef.current = null;
    lastLocalNormalizedValueRef.current = html;
    debouncedPushHistorySnapshot(html);
    onChange(html);
  }, [debouncedPushHistorySnapshot, editorRef, insertPlainText, onChange, onSlashLab]);

  const handleActivateInteraction = useCallback(() => {
    notifyActive();
  }, [notifyActive]);

  const handleBlur = useCallback(() => {
    const editor = editorRef.current;
    flushPendingHistorySnapshot();
    if (editor && pendingExternalNormalizedValueRef.current != null) {
      const nextNormalizedValue = pendingExternalNormalizedValueRef.current;
      const currentNormalizedValue = normalizeClinicalDocumentContentForStorage(editor.innerHTML);
      const hasLocalEditAfterExternalValue =
        currentNormalizedValue === lastLocalNormalizedValueRef.current;
      if (!hasLocalEditAfterExternalValue && currentNormalizedValue !== nextNormalizedValue) {
        editor.innerHTML = nextNormalizedValue;
        lastLocalNormalizedValueRef.current = nextNormalizedValue;
        seedHistory(nextNormalizedValue);
      }
      pendingExternalNormalizedValueRef.current = null;
    }
    isActiveRef.current = false;
    onDeactivateRef.current?.(sectionId);
  }, [editorRef, flushPendingHistorySnapshot, seedHistory, sectionId]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!editorRef.current || disabled) return;
      const command = resolveClinicalDocumentKeyboardShortcut(event);
      if (command) {
        event.preventDefault();
        applyEditorCommand(command);
      }
    },
    [applyEditorCommand, disabled, editorRef]
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      event.preventDefault();
      const editor = editorRef.current;
      if (!editor) return;

      const descriptor = classifyPasteContent(event.clipboardData);

      if (descriptor.kind === 'empty') return;

      if (descriptor.kind === 'image-file') {
        if (descriptor.requiresStorage) {
          if (!onUploadPastedImage) {
            onImagePasteRejected?.('No se pudo subir la imagen como archivo del episodio.');
            return;
          }
          void onUploadPastedImage(descriptor.file).then(uploadedImage => {
            if (!uploadedImage) {
              onImagePasteRejected?.('No se pudo subir la imagen como archivo del episodio.');
              return;
            }
            insertHtml(buildPastedStorageImageHtml(uploadedImage));
          });
          return;
        }
        void readFileAsDataUrl(descriptor.file).then(dataUrl => {
          insertHtml(buildPastedImageHtml(dataUrl));
        });
        return;
      }

      if (descriptor.kind === 'image-too-large') {
        onImagePasteRejected?.(descriptor.message);
        return;
      }

      if (descriptor.kind === 'html') {
        insertHtml(descriptor.sanitizedHtml);
      } else {
        insertPlainText(descriptor.text);
      }
    },
    [editorRef, insertHtml, insertPlainText, onImagePasteRejected, onUploadPastedImage]
  );

  return {
    commitEditorDomMutation,
    handleActivateInteraction,
    handleBlur,
    handleInput,
    handleKeyDown,
    handlePaste,
  };
};
