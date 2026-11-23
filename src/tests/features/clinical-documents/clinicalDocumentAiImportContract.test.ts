// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  parseClinicalDocumentAiImportJson,
  sanitizeClinicalDocumentAiImportSourceText,
  validateClinicalDocumentAiImportSourceText,
} from '@/shared/contracts/clinicalDocumentAiImportContract';

describe('clinicalDocumentAiImportContract', () => {
  it('is portable and sanitizes administrative identifiers before AI use', () => {
    const sanitized = sanitizeClinicalDocumentAiImportSourceText(`
      Nombre completo: Juan Perez Hanga
      Paciente: Maria Rapa Nui
      RUT: 12.345.678-9
      Ficha: 445566
      Traslado por neumonia adquirida en la comunidad.
      Tratamiento con ceftriaxona 1 g cada 24 horas.
    `);

    expect(sanitized).not.toContain('Juan Perez Hanga');
    expect(sanitized).not.toContain('Maria Rapa Nui');
    expect(sanitized).not.toContain('12.345.678-9');
    expect(sanitized).not.toContain('445566');
    expect(sanitized).toContain('Traslado por neumonia adquirida en la comunidad.');
    expect(sanitized).toContain('Tratamiento con ceftriaxona 1 g cada 24 horas.');
  });

  it('parses AI JSON without depending on app-only document factories', () => {
    const parsed = parseClinicalDocumentAiImportJson(
      JSON.stringify({
        antecedentes: 'Nombre completo: Juan Perez\nHTA.',
        historiaEvolucionClinica: 'Traslado por neumonia.',
        examenesComplementarios: '',
        diagnosticosEgreso: 'Neumonia.',
        planEgreso: '',
      })
    );

    expect(parsed).toMatchObject({
      status: 'success',
      data: {
        antecedentes: 'HTA.',
        historiaEvolucionClinica: 'Traslado por neumonia.',
      },
    });
  });

  it('validates that source text still has useful clinical content after sanitization', () => {
    const sanitized = sanitizeClinicalDocumentAiImportSourceText(`
      Nombre completo: Juan Perez Hanga
      RUT: 12.345.678-9
    `);

    expect(validateClinicalDocumentAiImportSourceText(sanitized)).toMatchObject({
      ok: false,
      message: 'No se pudo extraer texto util del archivo.',
    });
  });
});
