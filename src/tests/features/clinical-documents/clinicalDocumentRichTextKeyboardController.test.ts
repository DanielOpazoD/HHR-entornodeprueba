// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { resolveClinicalDocumentKeyboardShortcut } from '@/features/clinical-documents/controllers/clinicalDocumentRichTextKeyboardController';

describe('clinicalDocumentRichTextKeyboardController', () => {
  it('maps primary shortcuts to formatting and history commands', () => {
    expect(
      resolveClinicalDocumentKeyboardShortcut({
        key: 'b',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      })
    ).toBe('bold');

    expect(
      resolveClinicalDocumentKeyboardShortcut({
        key: 'z',
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
      })
    ).toBe('redo');
  });

  it('maps tab shortcuts to indentation commands', () => {
    expect(
      resolveClinicalDocumentKeyboardShortcut({
        key: 'Tab',
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      })
    ).toBe('indent');

    expect(
      resolveClinicalDocumentKeyboardShortcut({
        key: 'Tab',
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
      })
    ).toBe('outdent');
  });

  it('returns null when no supported shortcut matches', () => {
    expect(
      resolveClinicalDocumentKeyboardShortcut({
        key: 'x',
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      })
    ).toBeNull();
  });
});
