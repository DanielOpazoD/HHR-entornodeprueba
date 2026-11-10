/**
 * Tests for the clinical update section controller.
 */

import { describe, it, expect } from 'vitest';
import { createClinicalUpdateSection } from '@/features/clinical-documents/controllers/clinicalDocumentUpdateController';
import type { ClinicalDocumentSection } from '@/domain/clinical-documents/entities';

const existingSections: ClinicalDocumentSection[] = [
  { id: 'antecedentes', title: 'Antecedentes', content: '', order: 1, visible: true },
  { id: 'historia', title: 'Historia', content: '', order: 2, visible: true },
];

describe('createClinicalUpdateSection', () => {
  it('creates a section with kind clinical-update', () => {
    const section = createClinicalUpdateSection(existingSections);
    expect(section.kind).toBe('clinical-update');
  });

  it('sets order higher than all existing sections', () => {
    const section = createClinicalUpdateSection(existingSections);
    expect(section.order).toBeGreaterThan(2);
  });

  it('auto-populates updateDate in YYYY-MM-DD format', () => {
    const section = createClinicalUpdateSection(existingSections);
    expect(section.updateDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('auto-populates updateTime in HH:MM format', () => {
    const section = createClinicalUpdateSection(existingSections);
    expect(section.updateTime).toMatch(/^\d{2}:\d{2}$/);
  });

  it('generates unique IDs for multiple updates', () => {
    const first = createClinicalUpdateSection(existingSections);
    const withFirst = [...existingSections, first];
    const second = createClinicalUpdateSection(withFirst);
    expect(first.id).not.toBe(second.id);
  });

  it('starts with empty content', () => {
    const section = createClinicalUpdateSection(existingSections);
    expect(section.content).toBe('');
  });

  it('is visible and not required', () => {
    const section = createClinicalUpdateSection(existingSections);
    expect(section.visible).toBe(true);
    expect(section.required).toBe(false);
  });

  it('handles empty existing sections', () => {
    const section = createClinicalUpdateSection([]);
    expect(section.order).toBe(1);
  });
});
