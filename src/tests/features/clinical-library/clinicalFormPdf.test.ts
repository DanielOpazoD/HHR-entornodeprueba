// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream, StandardFonts } from 'pdf-lib';
import {
  CLINICAL_FORMS,
  CLINICAL_VARIABLE_CATALOG,
  getClinicalForm,
} from '@/features/clinical-library/domain/forms/clinicalFormCatalog';
import {
  CLINICAL_FORM_IDS,
  type ClinicalFormDefinition,
  type ClinicalFormValues,
} from '@/features/clinical-library/domain/forms/clinicalFormTypes';
import { createClinicalFormPdf } from '@/features/clinical-library/services/clinicalFormPdf';
import { layoutClinicalFormText } from '@/features/clinical-library/services/clinicalFormPdfLayout';

const template = (form: ClinicalFormDefinition) =>
  new Uint8Array(readFileSync(`public${form.templateUrl}`));
const streams = (pdf: PDFDocument, pageNumber = 0) => {
  const contents = pdf.getPage(pageNumber).node.Contents();
  if (contents instanceof PDFRawStream)
    return [Buffer.from(decodePDFRawStream(contents).decode()).toString('latin1')];
  if (!(contents instanceof PDFArray)) return [];
  return contents
    .asArray()
    .map(ref => pdf.context.lookup(ref))
    .filter((object): object is PDFRawStream => object instanceof PDFRawStream)
    .map(stream => Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1'));
};
const sample = (form: ClinicalFormDefinition): ClinicalFormValues =>
  Object.fromEntries(
    form.fields.map(field => [
      field.id,
      field.id === 'paciente_rut' || field.id === 'medico_tratante_rut'
        ? '11.111.111-1'
        : field.kind === 'check' || field.kind === 'boolean'
          ? true
          : field.kind === 'date'
            ? '2026-10-16'
            : field.kind === 'time'
              ? '08:30'
              : field.kind === 'choice'
                ? field.options![0].value
                : '123',
    ])
  );

describe('original clinical form print contracts', () => {
  it('covers every requested template and uses common variables consistently', () => {
    expect(CLINICAL_FORMS.map(form => form.id).sort()).toEqual([...CLINICAL_FORM_IDS].sort());
    expect(CLINICAL_FORMS.flatMap(form => form.fields).length).toBe(328);
    const common = new Set(CLINICAL_VARIABLE_CATALOG.variables.map(variable => variable.id));
    const prefixes =
      /^(imagen|contraste|consentimiento|laboratorio|vdrl|serologia|tbc|traslado|vmi)_/;
    for (const form of CLINICAL_FORMS) {
      expect(new Set(form.fields.map(field => field.id)).size).toBe(form.fields.length);
      expect(form.catalogVersion).toBe(CLINICAL_VARIABLE_CATALOG.version);
      for (const field of form.fields) {
        expect(common.has(field.id) || prefixes.test(field.id), field.id).toBe(true);
        expect(field.targets.length).toBeGreaterThan(0);
        for (const target of field.targets) {
          const page = form.pages[target.page];
          const [x, y, w, h] = target.rect;
          expect(
            x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= page.width && y + h <= page.height,
            field.id
          ).toBe(true);
        }
      }
    }
  });

  it.each(CLINICAL_FORMS)(
    '$id retains the verified source, page dimensions and all original content',
    async form => {
      expect(
        createHash('sha256')
          .update(readFileSync(`public${form.sourceUrl}`))
          .digest('hex')
      ).toBe(form.sourceSha256);
      const source = await PDFDocument.load(template(form));
      const printed = await PDFDocument.load(
        await createClinicalFormPdf(template(form), form, sample(form))
      );
      const suppressed = await PDFDocument.load(
        await createClinicalFormPdf(
          template(form),
          form,
          sample(form),
          form.fields.map(field => field.id)
        )
      );
      expect(printed.getPageCount()).toBe(source.getPageCount());
      for (let i = 0; i < source.getPageCount(); i++) {
        expect(printed.getPage(i).getSize()).toEqual(source.getPage(i).getSize());
        // Original operators survive verbatim, including the VMI reference page.
        for (const stream of streams(source, i)) {
          expect(streams(printed, i)).toContain(stream);
          expect(streams(suppressed, i)).toContain(stream);
        }
      }
      expect(printed.getForm().getFields()).toHaveLength(0);
      // With all variables suppressed, there is no injected text or X.
      expect(streams(suppressed).join('\n')).not.toContain('<313233>');
    }
  );

  it('prints only VMI patient identification and leaves all observations and the reference page blank', async () => {
    const form = getClinicalForm('planilla-monitorizacion-ventilatoria');
    const patient = {
      paciente_nombre_completo: 'PACIENTE VMI PRUEBA',
      paciente_rut: '11.111.111-1',
      ingreso_fecha: '2026-10-13',
    };
    const source = await PDFDocument.load(template(form));
    const printed = await PDFDocument.load(
      await createClinicalFormPdf(template(form), form, patient)
    );
    const withOldValues = await PDFDocument.load(
      await createClinicalFormPdf(template(form), form, {
        ...patient,
        paciente_talla_cm: '199',
        diagnostico_texto: 'NO IMPRIMIR',
        vmi_fecha: '2026-10-16',
        vmi_peso_ideal: '99',
        vmi_registro_1_hora: '08:00',
        vmi_registro_1_peep: '15',
        vmi_coincide_dia: true,
        vmi_profesional_dia: 'NO IMPRIMIR',
      })
    );
    const drawn = streams(printed).join('\n');
    expect(drawn).toContain(
      Buffer.from(patient.paciente_nombre_completo).toString('hex').toUpperCase()
    );
    expect(drawn).toContain(Buffer.from(patient.paciente_rut).toString('hex').toUpperCase());
    expect(drawn).toContain('<3133> Tj');
    expect(drawn).toContain('<3130> Tj');
    expect(drawn).toContain('<32303236> Tj');
    expect(printed.getPageCount()).toBe(2);
    expect(streams(withOldValues)).toEqual(streams(printed));
    expect(streams(printed, 1)).toEqual(streams(source, 1));
    expect(streams(withOldValues, 1)).toEqual(streams(source, 1));
  });

  it('prints false as NO and null as neither, never both options', async () => {
    const form = getClinicalForm('encuesta-contraste');
    const pdf = await PDFDocument.load(
      await createClinicalFormPdf(template(form), form, { contraste_alergia: false })
    );
    const drawn = streams(pdf).join('\n');
    expect((drawn.match(/<58> Tj/g) ?? []).length).toBe(1);
    const noAnswer = await PDFDocument.load(
      await createClinicalFormPdf(template(form), form, { contraste_alergia: null })
    );
    expect(
      (
        streams(noAnswer)
          .join('\n')
          .match(/<58> Tj/g) ?? []
      ).length
    ).toBe(0);
  });

  it.each(
    CLINICAL_FORMS.filter(form => form.fields.some(field => field.id === 'paciente_ficha_numero'))
  )('$id never prints the clinical-record number even when a draft supplies it', async form => {
    const printed = await PDFDocument.load(
      await createClinicalFormPdf(template(form), form, { paciente_ficha_numero: 'FICHA-PRIVADA' })
    );
    expect(streams(printed)).toEqual(streams(await PDFDocument.load(template(form))));
  });

  it.each(CLINICAL_FORMS)(
    '$id uses 50% larger text when the original cell allows it',
    async form => {
      const field = form.fields.find(item =>
        item.targets.some(
          target => !Object.hasOwn(target, 'equals') && target.rect[2] >= 70 && target.rect[3] >= 11
        )
      )!;
      const target = field.targets.find(
        item => !Object.hasOwn(item, 'equals') && item.rect[2] >= 70 && item.rect[3] >= 11
      )!;
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const [line] = layoutClinicalFormText(
        field,
        target,
        'PRUEBA',
        font,
        form.pages[target.page].height,
        false
      );
      expect(line.size).toBe(13.5);
      expect(line.x + font.widthOfTextAtSize(line.text, line.size)).toBeLessThanOrEqual(
        target.rect[0] + target.rect[2]
      );
    }
  );

  it('rejects changed templates, unprintable characters and overflowing text', async () => {
    const form = getClinicalForm('consentimiento-informado');
    await expect(
      createClinicalFormPdf(template(form), { ...form, templateSha256: 'wrong' }, {})
    ).rejects.toThrow('plantilla cambió');
    await expect(
      createClinicalFormPdf(template(form), form, { paciente_nombre_completo: 'PRUEBA 🧪' })
    ).rejects.toThrow('caracteres');
    await expect(
      createClinicalFormPdf(template(form), form, {
        paciente_nombre_completo: 'Texto '.repeat(2000),
      })
    ).rejects.toThrow('no cabe');
  });

  it('prints every alternative of each exclusive group, including all sample types and indeterminate sex', async () => {
    for (const form of CLINICAL_FORMS) {
      const choices = form.fields.filter(
        field => field.kind === 'choice' || field.kind === 'boolean'
      );
      const rounds = Math.max(
        ...choices.map(field => (field.kind === 'boolean' ? 2 : field.options!.length))
      );
      for (let i = 0; i < rounds; i++) {
        const values = Object.fromEntries(
          choices.map(field => [
            field.id,
            field.kind === 'boolean' ? i === 0 : (field.options?.[i]?.value ?? null),
          ])
        );
        await expect(createClinicalFormPdf(template(form), form, values)).resolves.toBeInstanceOf(
          Uint8Array
        );
      }
    }
  });

  it('centers each mark within its original cell and fits accents and multiline text', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (const form of CLINICAL_FORMS)
      for (const field of form.fields)
        for (const target of field.targets) {
          if (!Object.hasOwn(target, 'equals')) continue;
          const [line] = layoutClinicalFormText(
            field,
            target,
            'X',
            font,
            form.pages[target.page].height,
            true
          );
          const [x, top, w, h] = target.rect;
          expect(line.x + font.widthOfTextAtSize('X', line.size) / 2).toBeCloseTo(x + w / 2, 5);
          expect(line.y + font.heightAtSize(line.size, { descender: false }) / 2).toBeCloseTo(
            form.pages[target.page].height - top - h / 2,
            5
          );
        }
    const form = getClinicalForm('informe-traslado-hospital-salvador');
    await expect(
      createClinicalFormPdf(template(form), form, {
        traslado_historia: 'Texto áéíóú, ñ y ü.\nSegunda línea.',
      })
    ).resolves.toBeInstanceOf(Uint8Array);
  });

  it.each([
    ['solicitud-laboratorio-policlinico', 'laboratorio_otros', 671.02, 12.24],
    ['encuesta-contraste', 'diagnostico_texto', 310, 13.5],
  ] as const)(
    'aligns %s multiline text to the original writing rules',
    async (formId, id, firstBaseline, lineHeight) => {
      const form = getClinicalForm(formId);
      const field = form.fields.find(item => item.id === id)!;
      const target = field.targets[0];
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const lines = layoutClinicalFormText(
        field,
        target,
        'ÁÉÍÓÚÑÜ gypq\nSegunda línea',
        font,
        form.pages[0].height,
        false
      );
      expect(lines).toHaveLength(2);
      expect(form.pages[0].height - lines[0].y).toBeCloseTo(firstBaseline, 3);
      expect(lines[0].y - lines[1].y).toBeCloseTo(lineHeight, 3);
      expect(lines[0].y + lines[0].size * 0.931).toBeLessThanOrEqual(
        form.pages[0].height - target.rect[1]
      );
      expect(lines[1].y - lines[1].size * 0.225).toBeGreaterThanOrEqual(
        form.pages[0].height - target.rect[1] - target.rect[3]
      );
    }
  );
});
