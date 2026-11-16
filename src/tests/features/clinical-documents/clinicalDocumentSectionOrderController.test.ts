// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  moveClinicalDocumentVisibleSection,
  reorderClinicalDocumentVisibleSections,
} from '@/features/clinical-documents/controllers/clinicalDocumentSectionOrderController';

const sections = [
  { id: 'intro', title: 'Intro', content: '', order: 0, visible: true },
  { id: 'hidden', title: 'Hidden', content: '', order: 1, visible: false },
  { id: 'plan', title: 'Plan', content: '', order: 2, visible: true },
  { id: 'summary', title: 'Summary', content: '', order: 3, visible: true },
] as const;

describe('clinicalDocumentSectionOrderController', () => {
  it('returns the same array when source and target are equal or missing', () => {
    expect(reorderClinicalDocumentVisibleSections([...sections], 'intro', 'intro')).toEqual(
      sections
    );
    expect(reorderClinicalDocumentVisibleSections([...sections], 'missing', 'summary')).toEqual(
      sections
    );
  });

  it('reorders only visible sections and preserves hidden sections at the end', () => {
    const reordered = reorderClinicalDocumentVisibleSections([...sections], 'summary', 'intro');

    expect(reordered.map(section => [section.id, section.order])).toEqual([
      ['summary', 0],
      ['intro', 1],
      ['plan', 2],
      ['hidden', 3],
    ]);
  });

  it('moves visible sections up and down while keeping boundary no-ops', () => {
    expect(moveClinicalDocumentVisibleSection([...sections], 'intro', 'up')).toEqual(sections);
    expect(moveClinicalDocumentVisibleSection([...sections], 'missing', 'down')).toEqual(sections);

    const movedDown = moveClinicalDocumentVisibleSection([...sections], 'intro', 'down');
    expect(movedDown.map(section => section.id)).toEqual(['plan', 'intro', 'summary', 'hidden']);

    const movedUp = moveClinicalDocumentVisibleSection([...sections], 'summary', 'up');
    expect(movedUp.map(section => section.id)).toEqual(['intro', 'summary', 'plan', 'hidden']);
  });
});
