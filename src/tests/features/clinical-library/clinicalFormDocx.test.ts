import { readFileSync, writeFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import PizZip from 'pizzip';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getClinicalForm } from '@/features/clinical-library/domain/forms/clinicalFormCatalog';
import { createClinicalFormDocx } from '@/features/clinical-library/services/clinicalFormDocx';

const form = getClinicalForm('informe-traslado-hospital-salvador');
const template = new Uint8Array(readFileSync(`public${form.sourceUrl}`));
const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const xml = (bytes: Uint8Array) =>
  new DOMParser().parseFromString(
    new PizZip(bytes).file('word/document.xml')!.asText(),
    'application/xml'
  );

describe('Hospital del Salvador Word export', () => {
  beforeAll(() => vi.stubGlobal('crypto', webcrypto));
  afterAll(() => vi.unstubAllGlobals());

  it('fills the original editable document and preserves every other package part and its page geometry', async () => {
    const values = {
      paciente_nombre_completo: 'MARÍA PÉREZ SOTO',
      paciente_rut: '11.111.111-1',
      paciente_edad_texto: '46 años',
      formulario_fecha_emision: '2026-10-16',
      paciente_fonasa_tramo: 'B',
      paciente_domicilio: 'DOMICILIO DE PRUEBA 123',
      paciente_ocupacion: 'OCUPACIÓN DE PRUEBA',
      traslado_auge: 'Sin dato',
      traslado_apoyo: 'FAMILIAR DE PRUEBA · 000000000',
      traslado_historia: 'Historia actual de prueba.\nSegunda línea con á, ñ y gypq.',
      traslado_examen_fisico: 'EXAMEN FÍSICO DE PRUEBA',
      traslado_anamnesis: 'ANTECEDENTES DE PRUEBA',
      traslado_estudio: 'ESTUDIO DE PRUEBA',
      traslado_resultados: 'RESULTADOS DE PRUEBA',
      traslado_tratamiento: 'TRATAMIENTO DE PRUEBA',
      diagnostico_texto: 'DIAGNÓSTICO DE PRUEBA',
      traslado_fundamento: 'FUNDAMENTO DE PRUEBA',
      traslado_solicitud: 'SOLICITUD DE PRUEBA',
      paciente_ficha_numero: 'NUNCA IMPRIMIR',
    };
    const bytes = await createClinicalFormDocx(template, form, values);
    const original = new PizZip(template);
    const generated = new PizZip(bytes);
    expect(Object.keys(generated.files).sort()).toEqual(Object.keys(original.files).sort());
    for (const [name, part] of Object.entries(original.files)) {
      if (name !== 'word/document.xml' && !part.dir)
        expect(generated.file(name)!.asUint8Array(), name).toEqual(part.asUint8Array());
    }
    const before = xml(template);
    const after = xml(bytes);
    expect(after.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(after.getElementsByTagNameNS(wordNamespace, 'sectPr')[0].outerHTML).toBe(
      before.getElementsByTagNameNS(wordNamespace, 'sectPr')[0].outerHTML
    );
    expect(after.getElementsByTagNameNS(wordNamespace, 'p').length).toBe(
      before.getElementsByTagNameNS(wordNamespace, 'p').length
    );
    for (const field of form.fields) {
      const expected =
        field.kind === 'date' ? '16/10/2026' : values[field.id as keyof typeof values];
      expect(after.documentElement.textContent).toContain(expected.replace(/\n/g, ''));
    }
    expect(after.documentElement.textContent).not.toContain('NUNCA IMPRIMIR');
    const insertedSizes = [...after.getElementsByTagNameNS(wordNamespace, 'sz')].filter(
      element => element.getAttributeNS(wordNamespace, 'val') === '27'
    );
    expect(insertedSizes).toHaveLength(form.fields.length);
    expect(template).toEqual(new Uint8Array(readFileSync(`public${form.sourceUrl}`)));
    if (process.env.CLINICAL_FORM_QA_DOCX) writeFileSync(process.env.CLINICAL_FORM_QA_DOCX, bytes);
  });

  it('leaves hidden values blank, escapes XML text and preserves multiline input', async () => {
    const bytes = await createClinicalFormDocx(
      template,
      form,
      {
        paciente_nombre_completo: 'NOMBRE OCULTO',
        traslado_historia: 'A & B < C > D\nSegunda línea',
      },
      ['paciente_nombre_completo']
    );
    const document = xml(bytes);
    expect(document.documentElement.textContent).not.toContain('NOMBRE OCULTO');
    expect(document.documentElement.textContent).toContain('A & B < C > D');
    expect(document.getElementsByTagNameNS(wordNamespace, 'br')).toHaveLength(
      xml(template).getElementsByTagNameNS(wordNamespace, 'br').length + 1
    );
    expect(document.getElementsByTagName('parsererror')).toHaveLength(0);
  });

  it('rejects unverified templates, unsupported forms, invalid identities and XML control characters', async () => {
    await expect(
      createClinicalFormDocx(template, { ...form, sourceSha256: 'changed' }, {})
    ).rejects.toThrow('plantilla Word cambió');
    await expect(
      createClinicalFormDocx(template, getClinicalForm('encuesta-contraste'), {})
    ).rejects.toThrow('salida Word');
    await expect(
      createClinicalFormDocx(template, form, { paciente_rut: '11.111.111-2' })
    ).rejects.toThrow('RUT');
    await expect(
      createClinicalFormDocx(template, form, { traslado_historia: 'Texto\u0001inválido' })
    ).rejects.toThrow('caracteres');
  });
});
