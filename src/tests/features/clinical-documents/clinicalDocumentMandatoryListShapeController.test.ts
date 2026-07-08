import { describe, expect, it } from 'vitest';

import {
  editorMatchesMandatoryListShape,
  enforceMandatoryListShape,
} from '@/features/clinical-documents/controllers/clinicalDocumentMandatoryListShapeController';

const mountEditor = (innerHtml: string): HTMLDivElement => {
  const editor = document.createElement('div');
  editor.contentEditable = 'true';
  editor.innerHTML = innerHtml;
  document.body.appendChild(editor);
  return editor;
};

const cleanup = (editor: HTMLDivElement) => {
  editor.remove();
};

describe('editorMatchesMandatoryListShape', () => {
  it('returns true when the editor wraps content in the required list with at least one li', () => {
    const editor = mountEditor('<ol><li>uno</li><li>dos</li></ol>');
    expect(editorMatchesMandatoryListShape(editor, 'ol')).toBe(true);
    cleanup(editor);
  });

  it('returns false when the wrapper tag does not match', () => {
    const editor = mountEditor('<ul><li>uno</li></ul>');
    expect(editorMatchesMandatoryListShape(editor, 'ol')).toBe(false);
    cleanup(editor);
  });

  it('returns false when the editor contains no list at all', () => {
    const editor = mountEditor('<div>texto plano</div>');
    expect(editorMatchesMandatoryListShape(editor, 'ul')).toBe(false);
    cleanup(editor);
  });

  it('returns false when extra siblings exist after the list', () => {
    const editor = mountEditor('<ul><li>x</li></ul><div>basura</div>');
    expect(editorMatchesMandatoryListShape(editor, 'ul')).toBe(false);
    cleanup(editor);
  });

  it('returns false when the list exists but has no list items', () => {
    const editor = mountEditor('<ol></ol>');
    expect(editorMatchesMandatoryListShape(editor, 'ol')).toBe(false);
    cleanup(editor);
  });
});

describe('enforceMandatoryListShape', () => {
  it('is a no-op when the editor already complies', () => {
    const editor = mountEditor('<ol><li>uno</li></ol>');
    const mutated = enforceMandatoryListShape(editor, 'ol');
    expect(mutated).toBe(false);
    expect(editor.innerHTML).toBe('<ol><li>uno</li></ol>');
    cleanup(editor);
  });

  it('rebuilds the list wrapper when the user has destroyed it (plain text remains)', () => {
    const editor = mountEditor('<div>uno</div><div>dos</div>');
    const mutated = enforceMandatoryListShape(editor, 'ul');
    expect(mutated).toBe(true);
    expect(editor.innerHTML).toBe('<ul><li>uno</li><li>dos</li></ul>');
    cleanup(editor);
  });

  it('restores an empty list scaffold when the editor is left blank', () => {
    const editor = mountEditor('');
    const mutated = enforceMandatoryListShape(editor, 'ol');
    expect(mutated).toBe(true);
    expect(editor.innerHTML).toBe('<ol><li><br></li></ol>');
    cleanup(editor);
  });

  it('escapes HTML special characters when rebuilding from text', () => {
    const editor = mountEditor('<div>1 &lt; 2 &amp; 3</div>');
    enforceMandatoryListShape(editor, 'ol');
    expect(editor.innerHTML).toContain('1 &lt; 2 &amp; 3');
    expect(editor.innerHTML).not.toContain('<script>');
    cleanup(editor);
  });

  it('replaces a wrong wrapper tag with the required one', () => {
    const editor = mountEditor('<ul><li>x</li></ul>');
    const mutated = enforceMandatoryListShape(editor, 'ol');
    expect(mutated).toBe(true);
    expect(editor.innerHTML).toBe('<ol><li>x</li></ol>');
    cleanup(editor);
  });

  it('preserves inline formatting (bold/italic/colour) when repairing a stray sibling', () => {
    // Reproduces the browser behaviour where pressing Enter exits the list and
    // leaves a trailing block sibling, tripping the shape check.
    const editor = mountEditor(
      '<ol><li><b>Diagnostico uno</b></li><li>Diagnostico <span style="color: rgb(220, 38, 38)">dos</span></li></ol><div><br></div>'
    );
    const mutated = enforceMandatoryListShape(editor, 'ol');
    expect(mutated).toBe(true);
    expect(editor.innerHTML).toBe(
      '<ol><li><b>Diagnostico uno</b></li><li>Diagnostico <span style="color: rgb(220, 38, 38)">dos</span></li></ol>'
    );
    cleanup(editor);
  });

  it('preserves inline formatting when the wrapper itself was destroyed', () => {
    const editor = mountEditor('<div><b>uno</b></div><div><i>dos</i></div>');
    enforceMandatoryListShape(editor, 'ul');
    expect(editor.innerHTML).toBe('<ul><li><b>uno</b></li><li><i>dos</i></li></ul>');
    cleanup(editor);
  });

  it('strips unsafe markup (event handlers, disallowed tags) while repairing the list', () => {
    const editor = mountEditor(
      '<ol><li><b onclick="alert(1)">Dx</b><script>alert(1)</script></li></ol><div>stray</div>'
    );
    enforceMandatoryListShape(editor, 'ol');

    expect(editor.innerHTML).not.toContain('onclick');
    expect(editor.innerHTML).not.toContain('<script');
    // The documented inline formatting survives, just without the handler.
    expect(editor.innerHTML).toContain('<b>Dx</b>');
    cleanup(editor);
  });
});
