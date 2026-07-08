/**
 * Integration test for the rich-text editor's mandatory list-shape guard.
 *
 * Mounts {@link ClinicalDocumentRichTextEditor} with a `mandatoryListType`
 * (the runtime configuration used by "Diagnósticos de egreso" and
 * "Indicaciones al alta") and exercises the two paths that protect the list
 * scaffold from being destroyed:
 *
 * 1. `guardedInput` — runs `enforceMandatoryListShape` before the controller's
 *    persist step, rebuilding the wrapper if the DOM no longer matches.
 * 2. `guardedKeyDown` — preventDefault on Backspace/Delete that would
 *    dissolve the only/first list item.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

import { ClinicalDocumentRichTextEditor } from '@/features/clinical-documents/components/ClinicalDocumentRichTextEditor';

afterEach(() => {
  cleanup();
});

const renderEditor = (
  overrides: Partial<React.ComponentProps<typeof ClinicalDocumentRichTextEditor>> = {}
) => {
  const onChange = vi.fn();
  const utils = render(
    <ClinicalDocumentRichTextEditor
      sectionId="diagnosticos"
      sectionTitle="Diagnósticos"
      value=""
      emptyTemplate="<ol><li><br></li></ol>"
      mandatoryListType="ol"
      onChange={onChange}
      {...overrides}
    />
  );

  const editor = utils.container.querySelector('[data-section-editor]') as HTMLDivElement | null;
  if (!editor) throw new Error('Editor element not found');
  return { ...utils, editor, onChange };
};

const placeCaretAtStartOfFirstLi = (editor: HTMLDivElement): void => {
  const firstLi = editor.querySelector('li');
  if (!firstLi) throw new Error('First <li> not found');
  const range = document.createRange();
  range.selectNodeContents(firstLi);
  range.collapse(true);
  const selection = window.getSelection();
  if (!selection) throw new Error('window.getSelection() returned null');
  selection.removeAllRanges();
  selection.addRange(range);
};

describe('ClinicalDocumentRichTextEditor — mandatoryListType guard', () => {
  it('rebuilds the <ol> wrapper when an input event arrives without the mandatory shape', () => {
    const { editor } = renderEditor({ sectionId: 'diagnosticos', mandatoryListType: 'ol' });

    // Simulate the user having destroyed the list (e.g., via a paste, Cut+Replace,
    // or a Ctrl+A + retype that bypassed the keydown guard). The DOM no longer
    // contains an <ol> at all.
    editor.innerHTML = '<div>uno</div><div>dos</div>';
    fireEvent.input(editor);

    expect(editor.innerHTML).toBe('<ol><li>uno</li><li>dos</li></ol>');
  });

  it('rebuilds the <ul> wrapper for the indications section after destruction', () => {
    const { editor } = renderEditor({
      sectionId: 'plan',
      mandatoryListType: 'ul',
      emptyTemplate: '<ul><li><br></li></ul>',
    });

    editor.innerHTML = 'reposo<br>analgesia';
    fireEvent.input(editor);

    expect(editor.innerHTML).toBe('<ul><li>reposo</li><li>analgesia</li></ul>');
  });

  it('restores the empty scaffold when the editor is left blank by an input event', () => {
    const { editor } = renderEditor();

    editor.innerHTML = '';
    fireEvent.input(editor);

    expect(editor.innerHTML).toBe('<ol><li><br></li></ol>');
  });

  it('preventDefaults Backspace at the start of the only empty list item', () => {
    const { editor } = renderEditor();
    editor.innerHTML = '<ol><li><br></li></ol>';
    placeCaretAtStartOfFirstLi(editor);

    const wasNotPrevented = fireEvent.keyDown(editor, { key: 'Backspace' });

    // fireEvent returns `true` when the event was NOT canceled, `false` when it was.
    expect(wasNotPrevented).toBe(false);
    expect(editor.innerHTML).toBe('<ol><li><br></li></ol>');
  });

  it('preventDefaults Delete on the only empty list item', () => {
    const { editor } = renderEditor({ sectionId: 'plan', mandatoryListType: 'ul' });
    editor.innerHTML = '<ul><li><br></li></ul>';
    placeCaretAtStartOfFirstLi(editor);

    const wasNotPrevented = fireEvent.keyDown(editor, { key: 'Delete' });

    expect(wasNotPrevented).toBe(false);
    expect(editor.innerHTML).toBe('<ul><li><br></li></ul>');
  });

  it('lets non-destructive Backspace through (caret in middle of populated item)', () => {
    const { editor } = renderEditor();
    editor.innerHTML = '<ol><li>uno</li><li>dos</li></ol>';
    const secondLi = editor.querySelectorAll('li')[1];
    const range = document.createRange();
    range.selectNodeContents(secondLi);
    range.collapse(false);
    const selection = window.getSelection();
    if (!selection) throw new Error('selection unavailable');
    selection.removeAllRanges();
    selection.addRange(range);

    const wasNotPrevented = fireEvent.keyDown(editor, { key: 'Backspace' });

    // Caret is at end of second LI with content; the guard should not block.
    expect(wasNotPrevented).toBe(true);
  });

  it('does not interfere when no mandatoryListType is configured', () => {
    const { editor } = renderEditor({
      sectionId: 'antecedentes',
      mandatoryListType: null,
      emptyTemplate: null,
    });

    editor.innerHTML = '<div>texto libre</div>';
    fireEvent.input(editor);

    // Without a mandatory shape, the editor's content is left untouched
    // (the controller may normalize whitespace, but the wrapping <ol>/<ul>
    // is never injected here).
    expect(editor.innerHTML).toBe('<div>texto libre</div>');
  });
});
