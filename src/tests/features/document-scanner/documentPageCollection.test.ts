import { describe, expect, it } from 'vitest';
import {
  moveDocumentPage,
  removeDocumentPage,
} from '@/features/document-scanner/services/documentPageCollection';

describe('document page collection', () => {
  it('reorders only the selected page and returns its new position', () => {
    const document = { pages: ['one', 'two', 'three'] };

    expect(moveDocumentPage(document, 2, 0)).toBe(0);
    expect(document.pages).toEqual(['three', 'one', 'two']);
  });

  it('keeps a valid selected index after deleting a page', () => {
    const document = { pages: ['one', 'two'] };

    expect(removeDocumentPage(document, 1)).toBe(0);
    expect(document.pages).toEqual(['one']);
  });

  it('does not allow deleting the last page', () => {
    expect(() => removeDocumentPage({ pages: ['one'] }, 0)).toThrow('al menos una página');
  });
});
