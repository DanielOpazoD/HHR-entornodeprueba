import { describe, expect, it } from 'vitest';

import {
  getClinicalDocumentTypeLabel,
  listActiveClinicalDocumentTemplates,
} from '@/features/clinical-documents/controllers/clinicalDocumentTemplateController';

describe('clinicalDocumentTemplateController', () => {
  it('lists the active templates required by the Diario-aligned clinical editor', () => {
    const templates = listActiveClinicalDocumentTemplates();
    expect(templates.map(template => template.id)).toEqual(
      expect.arrayContaining(['epicrisis', 'evolucion', 'informe_medico', 'otro'])
    );
    expect(templates.map(template => template.id)).toContain('epicrisis_traslado');
  });

  it('maps document types to compact labels', () => {
    expect(getClinicalDocumentTypeLabel('epicrisis')).toBe('Epicrisis');
    expect(getClinicalDocumentTypeLabel('epicrisis_traslado')).toBe('Epicrisis traslado');
    expect(getClinicalDocumentTypeLabel('otro')).toBe('Otro');
  });
});
