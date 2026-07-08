import { afterEach, describe, expect, it } from 'vitest';

import { removeTrailingPatternAtCaret } from '@/features/clinical-documents/controllers/clinicalDocumentEditorInsertionController';

const SLASH_LAB = /\/lab\s*$/;

const mountEditor = (text: string): HTMLDivElement => {
  const editor = document.createElement('div');
  editor.contentEditable = 'true';
  editor.textContent = text;
  document.body.appendChild(editor);
  return editor;
};

const placeCaretAtEnd = (editor: HTMLDivElement): void => {
  const textNode = editor.firstChild as Text;
  const selection = window.getSelection();
  if (!selection) throw new Error('no selection');
  const range = document.createRange();
  range.setStart(textNode, (textNode.textContent ?? '').length);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('removeTrailingPatternAtCaret', () => {
  it('removes the trailing match and keeps the caret at the removal point', () => {
    const editor = mountEditor('Nota /lab ');
    placeCaretAtEnd(editor);

    expect(removeTrailingPatternAtCaret(editor, SLASH_LAB)).toBe(true);
    expect(editor.textContent).toBe('Nota ');

    const range = window.getSelection()!.getRangeAt(0);
    expect(range.collapsed).toBe(true);
    expect(range.startOffset).toBe('Nota '.length);
    expect(editor.contains(range.startContainer)).toBe(true);
  });

  it('returns false (no mutation) when the caret text does not end with the pattern', () => {
    const editor = mountEditor('Nota sin comando');
    placeCaretAtEnd(editor);

    expect(removeTrailingPatternAtCaret(editor, SLASH_LAB)).toBe(false);
    expect(editor.textContent).toBe('Nota sin comando');
  });

  it('returns false when there is no active selection', () => {
    const editor = mountEditor('x /lab ');
    window.getSelection()?.removeAllRanges();

    expect(removeTrailingPatternAtCaret(editor, SLASH_LAB)).toBe(false);
    expect(editor.textContent).toBe('x /lab ');
  });

  it('removes the pattern even when it spans multiple text nodes', () => {
    // "/lab " split across an inline boundary: "Nota /la" + "b ".
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.appendChild(document.createTextNode('Nota /la'));
    editor.appendChild(document.createTextNode('b '));
    document.body.appendChild(editor);

    const lastNode = editor.lastChild as Text;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(lastNode, (lastNode.textContent ?? '').length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    expect(removeTrailingPatternAtCaret(editor, SLASH_LAB)).toBe(true);
    expect(editor.textContent).toBe('Nota ');
  });

  it('does not splice the pattern across a block boundary', () => {
    // "/la" ends one block and "b " starts the next — must NOT be matched as
    // "/lab" and deleted across the two blocks.
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.innerHTML = '<div>Nota /la</div><div>b </div>';
    document.body.appendChild(editor);

    const secondBlockText = editor.children[1].firstChild as Text;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(secondBlockText, (secondBlockText.textContent ?? '').length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    expect(removeTrailingPatternAtCaret(editor, SLASH_LAB)).toBe(false);
    expect(editor.textContent).toContain('/la');
  });

  it('returns false when the selection is not collapsed', () => {
    const editor = mountEditor('Nota /lab ');
    const textNode = editor.firstChild as Text;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, (textNode.textContent ?? '').length);
    selection.removeAllRanges();
    selection.addRange(range);

    expect(removeTrailingPatternAtCaret(editor, SLASH_LAB)).toBe(false);
    expect(editor.textContent).toBe('Nota /lab ');
  });
});
