// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { resolveClinicalDocumentIndicationSpecialty } from '@/features/clinical-documents/controllers/clinicalDocumentIndicationsController';

describe('clinicalDocumentIndicationsController', () => {
  it('resolves the specialty tab from the document specialty label', () => {
    expect(resolveClinicalDocumentIndicationSpecialty('Cirugía')).toBe('cirugia');
    expect(resolveClinicalDocumentIndicationSpecialty('TMT')).toBe('tmt');
    expect(resolveClinicalDocumentIndicationSpecialty('Medicina Interna')).toBe('medicina_interna');
    expect(resolveClinicalDocumentIndicationSpecialty('Psiquiatría')).toBe('psiquiatria');
    expect(resolveClinicalDocumentIndicationSpecialty('GyO')).toBe('ginecobstetricia');
    expect(resolveClinicalDocumentIndicationSpecialty('Pediatría')).toBe('pediatria');
  });
});
