import React, { useCallback, useRef, useState } from 'react';
import clsx from 'clsx';

import type { ClinicalDocumentRichTextEditorActivationApi } from '@/features/clinical-documents/hooks/clinicalDocumentRichTextEditorTypes';
import { useClinicalDocumentRichTextEditorController } from '@/features/clinical-documents/hooks/useClinicalDocumentRichTextEditorController';
import { ClinicalDocumentImageEditor } from '@/features/clinical-documents/components/ClinicalDocumentImageEditor';
import type { ClinicalDocumentMandatoryListType } from '@/features/clinical-documents/controllers/clinicalDocumentEmptySectionTemplateController';
import {
  editorMatchesMandatoryListShape,
  enforceMandatoryListShape,
} from '@/features/clinical-documents/controllers/clinicalDocumentMandatoryListShapeController';

interface ClinicalDocumentRichTextEditorProps {
  sectionId: string;
  sectionTitle: string;
  value: string;
  disabled?: boolean;
  /**
   * HTML scaffold rendered when `value` is empty (e.g. `<ol><li><br></li></ol>`).
   * The scaffold is purely visual — it is NOT persisted; only the user's typed
   * content propagates via `onChange`.
   */
  emptyTemplate?: string | null;
  /**
   * When set, the editor's content MUST stay wrapped in `<ol>` or `<ul>`. The
   * wrapper is restored automatically if the user deletes it (Backspace at
   * start, Select-All + Delete, etc).
   */
  mandatoryListType?: ClinicalDocumentMandatoryListType | null;
  onChange: (value: string) => void;
  onActivate?: (sectionId: string, editor: ClinicalDocumentRichTextEditorActivationApi) => void;
  onDeactivate?: (sectionId: string) => void;
  onUploadPastedImage?: (file: File) => Promise<{
    attachmentId: string;
    imageUrl: string;
    storagePath: string;
  } | null>;
  onImagePasteRejected?: (message: string) => void;
  /** Called when user types `/lab` — should return formatted lab text or null. */
  onSlashLab?: () => Promise<string | null>;
}

const isEffectivelyEmpty = (value: string): boolean => !value.trim();

/**
 * Places the caret inside the first list item of the editor when the editor
 * still holds the empty-template scaffold. Avoids the caret landing outside
 * the `<li>` after the user clicks an inert area of the editor.
 */
const placeCaretInsideEmptyTemplate = (editor: HTMLDivElement): void => {
  const firstListItem = editor.querySelector('li');
  if (!firstListItem) return;
  if ((firstListItem.textContent || '').trim() !== '') return;
  const range = document.createRange();
  range.selectNodeContents(firstListItem);
  range.collapse(true);
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
};

/**
 * Returns true when a Backspace at the current selection would dissolve the
 * list wrapper (caret is at the very start of the first/only `<li>`, with no
 * other items to absorb the merge).
 */
const isBackspaceAtListBoundary = (editor: HTMLDivElement): boolean => {
  if (typeof window === 'undefined') return false;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  if (!range.collapsed) return false;
  const list = editor.firstElementChild;
  if (!list) return false;
  const items = list.querySelectorAll(':scope > li');
  if (items.length === 0) return false;
  const firstItem = items[0];
  if (!firstItem.contains(range.startContainer)) return false;
  // Caret at offset 0 of an empty/start position inside the first <li>.
  if (range.startOffset !== 0) return false;
  if (range.startContainer === firstItem) return true;
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    // First text node of the LI, caret at offset 0.
    const firstTextWalker = document.createTreeWalker(firstItem, NodeFilter.SHOW_TEXT);
    return firstTextWalker.nextNode() === range.startContainer;
  }
  return false;
};

export const ClinicalDocumentRichTextEditor: React.FC<ClinicalDocumentRichTextEditorProps> = ({
  sectionId,
  sectionTitle,
  value,
  disabled = false,
  emptyTemplate,
  mandatoryListType,
  onChange,
  onActivate,
  onDeactivate,
  onUploadPastedImage,
  onImagePasteRejected,
  onSlashLab,
}) => {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [selectedImage, setSelectedImage] = useState<HTMLImageElement | null>(null);

  const showEmptyTemplate = !disabled && emptyTemplate && isEffectivelyEmpty(value);
  const effectiveValue = showEmptyTemplate ? emptyTemplate! : value;

  const {
    commitEditorDomMutation,
    handleActivateInteraction,
    handleBlur,
    handleInput,
    handleKeyDown,
    handlePaste,
  } = useClinicalDocumentRichTextEditorController({
    sectionId,
    value: effectiveValue,
    disabled,
    editorRef,
    mandatoryListType,
    onChange,
    onActivate,
    onDeactivate,
    onUploadPastedImage,
    onImagePasteRejected,
    onSlashLab,
  });

  const guardedInput = useCallback(() => {
    if (mandatoryListType && editorRef.current) {
      enforceMandatoryListShape(editorRef.current, mandatoryListType);
    }
    handleInput();
  }, [handleInput, mandatoryListType]);

  const guardedKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (
        mandatoryListType &&
        editorRef.current &&
        (event.key === 'Backspace' || event.key === 'Delete') &&
        editorMatchesMandatoryListShape(editorRef.current, mandatoryListType)
      ) {
        const list = editorRef.current.firstElementChild;
        const items = list ? list.querySelectorAll(':scope > li') : null;
        const onlyItem = items && items.length === 1 ? items[0] : null;
        const onlyItemEmpty = onlyItem && (onlyItem.textContent || '').trim() === '';
        if (event.key === 'Backspace') {
          if (onlyItemEmpty || isBackspaceAtListBoundary(editorRef.current)) {
            event.preventDefault();
            return;
          }
        }
        if (event.key === 'Delete' && onlyItemEmpty) {
          event.preventDefault();
          return;
        }
      }
      handleKeyDown(event);
    },
    [handleKeyDown, mandatoryListType]
  );

  const activateAndAlignCaret = useCallback(() => {
    handleActivateInteraction();
    if (showEmptyTemplate && editorRef.current) {
      placeCaretInsideEmptyTemplate(editorRef.current);
    }
  }, [handleActivateInteraction, showEmptyTemplate]);

  // Detect click on an image inside the editor
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'IMG' && !disabled) {
        setSelectedImage(target as HTMLImageElement);
      } else {
        setSelectedImage(null);
      }
      activateAndAlignCaret();
    },
    [disabled, activateAndAlignCaret]
  );

  // When image is modified via the editor overlay, sync back to onChange
  const handleImageUpdate = useCallback(() => {
    commitEditorDomMutation();
  }, [commitEditorDomMutation]);

  const handleImageEditorClose = useCallback(() => {
    setSelectedImage(null);
  }, []);

  return (
    <div className="clinical-document-rich-text-wrap">
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-label={`Contenido ${sectionTitle}`}
        data-section-editor={sectionId}
        className={clsx(
          'clinical-document-textarea clinical-document-rich-text-editor',
          disabled && 'is-readonly'
        )}
        onInput={guardedInput}
        onFocus={activateAndAlignCaret}
        onClick={handleClick}
        onBlur={handleBlur}
        onKeyDown={guardedKeyDown}
        onPaste={handlePaste}
      />

      {selectedImage && (
        <ClinicalDocumentImageEditor
          imageElement={selectedImage}
          onUpdate={handleImageUpdate}
          onClose={handleImageEditorClose}
        />
      )}
    </div>
  );
};
