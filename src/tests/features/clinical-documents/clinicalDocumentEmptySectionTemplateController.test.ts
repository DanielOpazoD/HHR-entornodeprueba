import { describe, expect, it } from 'vitest';

import {
  resolveClinicalDocumentEmptySectionTemplate,
  resolveClinicalDocumentMandatoryListType,
} from '@/features/clinical-documents/controllers/clinicalDocumentEmptySectionTemplateController';

describe('resolveClinicalDocumentEmptySectionTemplate', () => {
  it('returns a numbered list scaffold for the diagnostics section', () => {
    expect(resolveClinicalDocumentEmptySectionTemplate('diagnosticos')).toBe(
      '<ol><li><br></li></ol>'
    );
  });

  it('returns a bulleted list scaffold for the unified plan section', () => {
    expect(resolveClinicalDocumentEmptySectionTemplate('plan')).toBe('<ul><li><br></li></ul>');
  });

  it('returns a bulleted list scaffold for each plan subsection editor', () => {
    expect(resolveClinicalDocumentEmptySectionTemplate('plan:generales')).toBe(
      '<ul><li><br></li></ul>'
    );
    expect(resolveClinicalDocumentEmptySectionTemplate('plan:farmacologicas')).toBe(
      '<ul><li><br></li></ul>'
    );
    expect(resolveClinicalDocumentEmptySectionTemplate('plan:control_clinico')).toBe(
      '<ul><li><br></li></ul>'
    );
  });

  it('returns null for sections without a list-default behavior', () => {
    expect(resolveClinicalDocumentEmptySectionTemplate('antecedentes')).toBeNull();
    expect(resolveClinicalDocumentEmptySectionTemplate('historia-evolucion')).toBeNull();
    expect(resolveClinicalDocumentEmptySectionTemplate('contenido')).toBeNull();
  });
});

describe('resolveClinicalDocumentMandatoryListType', () => {
  it('returns "ol" for the diagnostics section', () => {
    expect(resolveClinicalDocumentMandatoryListType('diagnosticos')).toBe('ol');
  });

  it('returns "ul" for the unified plan section and its subsections', () => {
    expect(resolveClinicalDocumentMandatoryListType('plan')).toBe('ul');
    expect(resolveClinicalDocumentMandatoryListType('plan:generales')).toBe('ul');
    expect(resolveClinicalDocumentMandatoryListType('plan:farmacologicas')).toBe('ul');
    expect(resolveClinicalDocumentMandatoryListType('plan:control_clinico')).toBe('ul');
  });

  it('returns null for sections without a mandatory list shape', () => {
    expect(resolveClinicalDocumentMandatoryListType('antecedentes')).toBeNull();
    expect(resolveClinicalDocumentMandatoryListType('historia-evolucion')).toBeNull();
  });
});
