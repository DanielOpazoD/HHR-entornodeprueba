import { readFileSync, writeFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import PizZip from 'pizzip';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { getClinicalForm } from '@/features/clinical-library/domain/forms/clinicalFormCatalog';
import {
  validateClinicalFormValues,
  exportClinicalFormDraft,
} from '@/features/clinical-library/domain/forms/clinicalFormDraft';
import { validateSicRequired } from '@/features/clinical-library/domain/forms/sicFormData';
import { createSicFormDocx } from '@/features/clinical-library/services/sicFormDocx';
import { createClinicalFormPdf } from '@/features/clinical-library/services/clinicalFormPdf';
import { addSicSignatureToPdf } from '@/features/clinical-library/services/sicFormPdf';

const form = getClinicalForm('solicitud-interconsulta-hhr');
const template = new Uint8Array(readFileSync(`public${form.sourceUrl}`));
const values = {
  formulario_fecha_emision: '2026-11-12',
  paciente_nombres: 'MARÍA ELENA',
  paciente_apellido_paterno: 'PÉREZ',
  paciente_apellido_materno: 'SOTO',
  paciente_nombre_completo: 'NO DEBE SUPERPONERSE',
  paciente_rut: '11.111.111-1',
  paciente_edad_texto: '46 años',
  paciente_fecha_nacimiento: '1980-02-29',
  paciente_sexo_biologico: 'Femenino',
  sic_especialidad: 'MEDICINA INTERNA',
  sic_establecimiento: 'HOSPITAL DEL SALVADOR',
  sic_tipo_consulta: 'Hospitalización',
  sic_confirmacion: true,
  sic_tratamiento: true,
  sic_examenes: true,
  sic_ges: true,
  sic_otro: true,
  diagnostico_texto: 'HIPÓTESIS DE PRUEBA',
  sic_fundamento: 'Fundamento de prueba sintético.\nSegunda línea con á, ñ, gypq.',
  sic_adjuntos: 'Exámenes de prueba.',
  sic_profesional_nombre: 'PROFESIONAL DE PRUEBA',
  sic_profesional_rut: '11.111.111-1',
  sic_fono_movil: '000000000',
  sic_fono_fijo: '000000000',
};
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const parse = (zip: PizZip) =>
  new DOMParser().parseFromString(zip.file('word/document.xml')!.asText(), 'application/xml');
const tags = (doc: Document, tag: string) => Array.from(doc.getElementsByTagNameNS(W, tag));

describe('SIC HHR', () => {
  beforeAll(() => vi.stubGlobal('crypto', webcrypto));
  afterAll(() => vi.unstubAllGlobals());
  it('enforces institutional constants even against imported preferences, and avoids duplicate names', () => {
    const result = validateClinicalFormValues(
      form,
      { ...values, sic_prioridad: 'Normal', sic_direccion: 'OTRA' },
      ['sic_prioridad', 'sic_direccion']
    );
    expect(result.sic_prioridad).toBe('Alta');
    expect(result.sic_direccion).toBe('Simón PAOA S/N');
    expect(result.paciente_nombre_completo).toBeNull();
    expect(() => validateSicRequired(result)).not.toThrow();
    expect(
      exportClinicalFormDraft(form.id, { ...values, signature: 'NOT EXPORTED' })
    ).not.toContain('NOT EXPORTED');
  });
  it('requires essential data and a reason, rejects contradictory choices and invalid RUT', () => {
    expect(() => validateSicRequired({})).toThrow('Fecha SIC');
    expect(() =>
      validateSicRequired({
        ...values,
        sic_confirmacion: false,
        sic_tratamiento: false,
        sic_examenes: false,
        sic_ges: false,
        sic_otro: false,
      })
    ).toThrow('Al menos un motivo');
    expect(() =>
      validateClinicalFormValues(
        form,
        {
          ...values,
          sic_tipo_consulta: 'Ambulatoria Hospitalización',
        },
        []
      )
    ).toThrow();
    expect(() =>
      validateClinicalFormValues(form, { ...values, sic_profesional_rut: '11.111.111-2' }, [])
    ).toThrow();
  });
  it('fills original Word cells, retains all table geometry/logos and exports a one-page PDF', async () => {
    const sourceZip = new PizZip(template),
      source = parse(sourceZip);
    const bytes = await createSicFormDocx(template, form, values);
    const resultZip = new PizZip(bytes),
      result = parse(resultZip);
    for (const tag of ['tblPr', 'tblGrid', 'trPr', 'tcPr', 'sectPr']) {
      const serialize = (doc: Document) =>
        tags(doc, tag).map(node => new XMLSerializer().serializeToString(node));
      expect(serialize(result)).toEqual(serialize(source));
    }
    for (const path of Object.keys(sourceZip.files).filter(
      path => path !== 'word/document.xml' && !sourceZip.files[path].dir
    )) {
      expect(resultZip.file(path)!.asUint8Array()).toEqual(sourceZip.file(path)!.asUint8Array());
    }
    expect(tags(result, 't').filter(node => node.textContent === '-')).toHaveLength(3);
    expect(result.documentElement.textContent).toContain('Simón PAOA S/N');
    expect(result.documentElement.textContent).toContain('MARÍA ELENA');
    expect(result.documentElement.textContent).not.toContain('NO DEBE SUPERPONERSE');
    expect(tags(result, 't').filter(node => node.textContent === 'X')).toHaveLength(8);
    const pdf = await createClinicalFormPdf(
      new Uint8Array(readFileSync(`public${form.templateUrl}`)),
      form,
      values
    );
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
    if (process.env.SIC_QA_OUTPUT) {
      writeFileSync(`${process.env.SIC_QA_OUTPUT}/sic-filled.docx`, bytes);
      writeFileSync(`${process.env.SIC_QA_OUTPUT}/sic-filled.pdf`, pdf);
    }
  });
  it('embeds the same local signature bytes without external links or extra pages', async () => {
    const png = new Uint8Array(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9foAAAAASUVORK5CYII=',
        'base64'
      )
    );
    const zip = new PizZip(await createSicFormDocx(template, form, values, [], png));
    expect(zip.file('word/media/sic-signature.png')!.asUint8Array()).toEqual(png);
    expect(zip.file('word/_rels/document.xml.rels')!.asText()).not.toContain(
      'TargetMode="External"'
    );
    const pdf = await addSicSignatureToPdf(
      new Uint8Array(readFileSync(`public${form.templateUrl}`)),
      png
    );
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });
  it('rejects drifted templates and oversized text rather than changing cells or truncating', async () => {
    await expect(createSicFormDocx(new Uint8Array([1]), form, values)).rejects.toThrow('plantilla');
    await expect(
      createSicFormDocx(template, form, { ...values, sic_fundamento: 'TEXTO '.repeat(2000) })
    ).rejects.toThrow();
  });
});
