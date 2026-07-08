/**
 * Regression test for the mandatory-list guard on the COMMAND path.
 *
 * Toolbar/keyboard commands (toggle list, outdent) flow through the editor's
 * `applyCommand` API, NOT through `onInput`. Before the fix, list-affecting
 * commands could strip the `<ol>`/`<ul>` wrapper of a mandatory-list section
 * and persist the broken shape, because `enforceMandatoryListShape` only ran on
 * input. This test mocks the low-level command to simulate a list-toggle that
 * dissolves the wrapper and asserts the controller restores it before persist.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

import { ClinicalDocumentRichTextEditor } from '@/features/clinical-documents/components/ClinicalDocumentRichTextEditor';
import type { ClinicalDocumentRichTextEditorActivationApi } from '@/features/clinical-documents/hooks/clinicalDocumentRichTextEditorTypes';

// Simulate the browser's `execCommand('insertOrderedList')` toggling the list
// OFF: the `<ol>` wrapper is replaced by a bare block, breaking the shape.
vi.mock(
  '@/features/clinical-documents/controllers/clinicalDocumentRichTextController',
  async () => {
    const actual = await vi.importActual<
      typeof import('@/features/clinical-documents/controllers/clinicalDocumentRichTextController')
    >('@/features/clinical-documents/controllers/clinicalDocumentRichTextController');
    return {
      ...actual,
      applyClinicalDocumentEditorCommand: vi.fn((command: string) => {
        if (command === 'insertOrderedList') {
          const editor = document.querySelector('[data-section-editor]');
          if (editor) editor.innerHTML = '<div>Diagnostico uno</div>';
        }
        return true;
      }),
    };
  }
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ClinicalDocumentRichTextEditor — mandatoryListType guard (command path)', () => {
  it('re-enforces the list wrapper after a command dissolves it', () => {
    const onChange = vi.fn();
    let api: ClinicalDocumentRichTextEditorActivationApi | null = null;

    const { container } = render(
      <ClinicalDocumentRichTextEditor
        sectionId="diagnosticos"
        sectionTitle="Diagnósticos"
        value="<ol><li>Diagnostico uno</li></ol>"
        mandatoryListType="ol"
        onChange={onChange}
        onActivate={(_sectionId, editorApi) => {
          api = editorApi;
        }}
      />
    );

    const editor = container.querySelector('[data-section-editor]') as HTMLDivElement;
    fireEvent.focus(editor);
    expect(api).not.toBeNull();

    // Apply the list-toggle command (mocked to strip the wrapper).
    api!.applyCommand('insertOrderedList');

    // The wrapper must be restored in the DOM and in the persisted value.
    expect(editor.innerHTML).toBe('<ol><li>Diagnostico uno</li></ol>');
    const lastPersisted = onChange.mock.calls.at(-1)?.[0];
    expect(lastPersisted).toBe('<ol><li>Diagnostico uno</li></ol>');
  });
});
