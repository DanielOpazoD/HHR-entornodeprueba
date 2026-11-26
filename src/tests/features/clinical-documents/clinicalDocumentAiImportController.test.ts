// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  buildClinicalDocumentAiImportedRecord,
  buildClinicalDocumentAiImportSections,
  parseClinicalDocumentAiImportJson,
  sanitizeClinicalDocumentAiImportSourceText,
  validateClinicalDocumentAiImportFile,
  validateClinicalDocumentAiImportSourceText,
} from '@/features/clinical-documents/controllers/clinicalDocumentAiImportController';

describe('clinicalDocumentAiImportController', () => {
  it('parses simplified AI JSON and rejects missing clinical sections', () => {
    const parsed = parseClinicalDocumentAiImportJson(
      JSON.stringify({
        antecedentes: 'HTA.',
        historiaEvolucionClinica: 'Traslado por neumonia.',
        examenesComplementarios: '',
        diagnosticosEgreso: 'Neumonia adquirida en la comunidad.',
        planEgreso: 'Continuar manejo antibiotico en hospital receptor.',
      })
    );

    expect(parsed.status).toBe('success');
    expect(parsed.data?.planEgreso).toBe('Continuar manejo antibiotico en hospital receptor.');

    const invalid = parseClinicalDocumentAiImportJson('{"antecedentes":"HTA"}');

    expect(invalid.status).toBe('failed');
    if (invalid.status === 'failed') {
      expect(invalid.error).toContain('respuesta IA');
    }
  });

  it('removes administrative patient identifiers from parsed import sections', () => {
    const parsed = parseClinicalDocumentAiImportJson(
      JSON.stringify({
        antecedentes:
          'Nombre completo: Juan Perez Hanga.\nRUT: 12.345.678-9\nHTA. Diabetes mellitus tipo 2.',
        historiaEvolucionClinica: 'Paciente: Maria Rapa Nui.\nEvoluciona estable durante traslado.',
        examenesComplementarios: 'RUN: 9.876.543-K\nRadiografia de torax compatible.',
        diagnosticosEgreso: 'Neumonia.',
        planEgreso: 'Continuar manejo antibiotico en centro receptor.',
      })
    );

    expect(parsed.status).toBe('success');
    expect(parsed.data?.antecedentes).toBe('HTA. Diabetes mellitus tipo 2.');
    expect(parsed.data?.historiaEvolucionClinica).toBe('Evoluciona estable durante traslado.');
    expect(parsed.data?.examenesComplementarios).toBe('Radiografia de torax compatible.');
  });

  it('sanitizes administrative patient identifiers before sending source text to AI', () => {
    const sanitized = sanitizeClinicalDocumentAiImportSourceText(`
      Nombre completo: Juan Perez Hanga
      Paciente: Maria Rapa Nui
      RUT: 12.345.678-9
      RUN 9.876.543-K
      Ficha: 445566
      Identificacion: ABC-123
      Traslado por neumonia adquirida en la comunidad.
      Tratamiento con ceftriaxona 1 g cada 24 horas.
    `);

    expect(sanitized).not.toContain('Juan Perez');
    expect(sanitized).not.toContain('Maria Rapa Nui');
    expect(sanitized).not.toContain('12.345.678-9');
    expect(sanitized).not.toContain('9.876.543-K');
    expect(sanitized).not.toContain('445566');
    expect(sanitized).not.toContain('ABC-123');
    expect(sanitized).toContain('Traslado por neumonia adquirida en la comunidad.');
    expect(sanitized).toContain('Tratamiento con ceftriaxona 1 g cada 24 horas.');
  });

  it('maps simplified import JSON to epicrisis traslado sections with safe HTML', () => {
    const sections = buildClinicalDocumentAiImportSections({
      antecedentes: 'HTA <controlada>',
      historiaEvolucionClinica: 'Dia 1: estable.\nDia 2: traslado.',
      examenesComplementarios: '',
      diagnosticosEgreso: 'Neumonia',
      planEgreso: 'Continuar tratamiento en centro receptor.',
    });

    expect(sections).toEqual([
      {
        id: 'antecedentes',
        title: 'Antecedentes',
        content: '<p>HTA &lt;controlada&gt;</p>',
        order: 0,
        required: true,
        visible: true,
      },
      {
        id: 'historia-evolucion',
        title: 'Historia y evolución clínica',
        content: '<p>Dia 1: estable.<br>Dia 2: traslado.</p>',
        order: 1,
        required: true,
        visible: true,
      },
      {
        id: 'examenes-complementarios',
        title: 'Exámenes complementarios',
        content: '',
        order: 2,
        required: false,
        visible: true,
      },
      {
        id: 'diagnosticos',
        title: 'Diagnósticos de egreso',
        content: '<p>Neumonia</p>',
        order: 3,
        required: false,
        visible: true,
      },
      {
        id: 'plan',
        title: 'Plan de egreso',
        content: '<p>Continuar tratamiento en centro receptor.</p>',
        order: 4,
        required: true,
        visible: true,
      },
    ]);
  });

  it('keeps non-explicit clinical fields empty instead of inferring content', () => {
    const sections = buildClinicalDocumentAiImportSections({
      antecedentes: '',
      historiaEvolucionClinica: 'Traslado por insuficiencia cardiaca.',
      examenesComplementarios: '',
      diagnosticosEgreso: '',
      planEgreso: '',
    });

    expect(sections.find(section => section.id === 'antecedentes')?.content).toBe('');
    expect(sections.find(section => section.id === 'examenes-complementarios')?.content).toBe('');
    expect(sections.find(section => section.id === 'diagnosticos')?.content).toBe('');
    expect(sections.find(section => section.id === 'plan')?.content).toBe('');
  });

  it('builds an editable AI-imported epicrisis traslado record with traceable version metadata', () => {
    const record = buildClinicalDocumentAiImportedRecord({
      payload: {
        antecedentes: 'HTA.',
        historiaEvolucionClinica: 'Traslado por neumonia.',
        examenesComplementarios: '',
        diagnosticosEgreso: 'Neumonia.',
        planEgreso: '',
      },
      hospitalId: 'hhr',
      actor: {
        uid: 'u1',
        email: 'doctor@test.cl',
        displayName: 'Doctor Test',
        role: 'doctor_urgency',
      },
      episode: {
        patientRut: '11.111.111-1',
        patientName: 'Paciente Test',
        episodeKey: '11.111.111-1__2026-03-06',
        admissionDate: '2026-03-06',
        sourceDailyRecordDate: '2026-03-06',
        sourceBedId: 'R1',
        specialty: 'Medicina',
      },
      patientFieldValues: {
        nombre: 'Paciente Test',
        rut: '11.111.111-1',
        edad: '40a',
        fecnac: '1986-01-01',
        fing: '2026-03-06',
        finf: '2026-03-06',
        hinf: '10:30',
      },
      medico: 'Doctor Test',
      especialidad: 'Medicina',
    });

    expect(record).toMatchObject({
      documentType: 'epicrisis_traslado',
      templateId: 'epicrisis_traslado',
      title: 'Epicrisis traslado',
      status: 'draft',
      isLocked: false,
      versionHistory: [
        expect.objectContaining({
          version: 1,
          reason: 'ai_import',
          changedSectionIds: [
            'antecedentes',
            'historia-evolucion',
            'examenes-complementarios',
            'diagnosticos',
            'plan',
          ],
        }),
      ],
    });
    expect(record.sections.find(section => section.id === 'plan')?.content).toBe('');
    expect(record.renderedText).toContain('Historia y evolución clínica');
    expect(record.integrityHash).toMatch(/^h/);
  });

  it('validates supported source files before extraction', () => {
    expect(
      validateClinicalDocumentAiImportFile({
        name: 'traslado.pdf',
        type: 'application/pdf',
        size: 1024,
      })
    ).toEqual({ ok: true });

    expect(
      validateClinicalDocumentAiImportFile({
        name: 'imagen.png',
        type: 'image/png',
        size: 1024,
      })
    ).toMatchObject({
      ok: false,
      message: 'Solo se aceptan archivos PDF o DOCX para importar con IA.',
    });

    expect(
      validateClinicalDocumentAiImportFile({
        name: 'traslado.pdf',
        type: 'application/pdf',
        size: 9 * 1024 * 1024,
      })
    ).toMatchObject({
      ok: false,
      message: 'El archivo supera el maximo permitido de 8 MB.',
    });
  });

  it('validates extracted source text before calling AI', () => {
    expect(validateClinicalDocumentAiImportSourceText('Traslado'.repeat(20))).toEqual({
      ok: true,
    });

    expect(validateClinicalDocumentAiImportSourceText('   ')).toMatchObject({
      ok: false,
      message: 'No se pudo extraer texto util del archivo.',
    });
  });
});
