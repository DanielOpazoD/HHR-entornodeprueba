// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { CLINICAL_DOCUMENT_DEFINITION_REGISTRY } from '@/domain/clinical-documents/definitions';
import type { ClinicalDocumentType } from '@/domain/clinical-documents/entities';

const SUPPORTED_TYPES: ClinicalDocumentType[] = [
  'epicrisis',
  'evolucion',
  'informe_medico',
  'epicrisis_traslado',
  'otro',
];

describe('clinicalDocumentDefinitionRegistry', () => {
  it.each(SUPPORTED_TYPES)('has a valid printable definition for %s', type => {
    const definition = CLINICAL_DOCUMENT_DEFINITION_REGISTRY[type];

    expect(definition).toBeDefined();
    expect(Number.isFinite(definition.schemaVersion)).toBe(true);
    expect(definition.printOptions).toMatchObject({
      pageSize: 'letter',
      mode: 'inline_browser_print',
    });
  });
});
