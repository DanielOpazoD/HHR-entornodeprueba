// @vitest-environment node
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import { createMedifPdf } from '@/features/clinical-library/services/medifPdf';
import { MEDIF_FIELDS, MEDIF_GROUPS } from '@/features/clinical-library/domain/medifSchema';
import {
  emptyMedifValues,
  setMedifFieldValue,
} from '@/features/clinical-library/domain/medifDraft';
import {
  emptyMedifPreferences,
  setMedifFieldHidden,
} from '@/features/clinical-library/domain/medifPreferences';

const template = readFileSync('public/docs/biblioteca/medif-latam-rellenable.pdf');
const sample = () => {
  let values = emptyMedifValues();
  for (const field of MEDIF_FIELDS.filter(item => item.kind === 'text')) {
    const width = field.rect[2] - field.rect[0];
    values = setMedifFieldValue(values, field.id, width < 40 ? '2' : 'José Muñoz');
  }
  for (const group of MEDIF_GROUPS) {
    if (group.type === 'choice') values = setMedifFieldValue(values, group.options[0].fieldId, 'X');
  }
  values = setMedifFieldValue(
    values,
    'p2_diagnostico_actual',
    'Texto áéíóú, ñ y ü.\nSegunda línea.'
  );
  return values;
};

describe('MEDIF PDF export', () => {
  it('matches every field and page of the reviewed interactive template', async () => {
    const pdf = await PDFDocument.load(template);
    expect(pdf.getPageCount()).toBe(3);
    expect(
      pdf
        .getForm()
        .getFields()
        .map(field => field.getName())
        .sort()
    ).toEqual(MEDIF_FIELDS.map(field => field.id).sort());
  });

  it('round-trips Spanish text, multiline entries and exclusive X responses across every section', async () => {
    const values = sample();
    const bytes = await createMedifPdf(template, values, emptyMedifPreferences(), 'editable');
    const pdf = await PDFDocument.load(bytes);
    for (const field of MEDIF_FIELDS)
      expect(pdf.getForm().getTextField(field.id).getText() || '').toBe(values[field.id]);
    expect(pdf.getPageCount()).toBe(3);
    if (process.env.MEDIF_QA_PDF) writeFileSync(process.env.MEDIF_QA_PDF, bytes);
  });

  it('exports X in all 68 mark geometries by rotating through every choice alternative', async () => {
    const choices = MEDIF_GROUPS.filter(group => group.type === 'choice');
    const markIds = MEDIF_FIELDS.filter(field => field.kind === 'mark').map(field => field.id);
    const visited = new Set<string>();
    const rounds = Math.max(...choices.map(group => group.options.length));
    expect(markIds).toHaveLength(68);
    expect(rounds).toBe(4);
    for (let index = 0; index < rounds; index += 1) {
      let values = emptyMedifValues();
      for (const group of choices) {
        const option = group.options[index];
        if (option) {
          values = setMedifFieldValue(values, option.fieldId, 'X');
          visited.add(option.fieldId);
        }
      }
      const pdf = await PDFDocument.load(
        await createMedifPdf(template, values, emptyMedifPreferences(), 'editable')
      );
      for (const id of markIds) {
        const field = pdf.getForm().getTextField(id);
        expect(field.getText() || '', `${id}: alternative ${index + 1}`).toBe(values[id]);
        if (values[id] !== 'X') continue;
        const appearance = field.acroField.getWidgets()[0].getAppearances()?.normal;
        expect(appearance, `${id}: visible X appearance`).toBeInstanceOf(PDFRawStream);
        if (!(appearance instanceof PDFRawStream)) throw new Error(`${id}: missing appearance`);
        const operators = Buffer.from(decodePDFRawStream(appearance).decode()).toString('latin1');
        expect(operators, `${id}: rendered X`).toMatch(/<58>\s*Tj/);
      }
    }
    expect([...visited].sort()).toEqual(markIds.sort());
  });

  it('keeps accented capitals and descenders inside short fields using the full Helvetica glyph box', async () => {
    const ids = [
      'p1_acompanante_1',
      'p1_contacto_sin_acompanante_1',
      'p1_contacto_sin_acompanante_2',
      'p1_medico_autorizado',
    ];
    let values = emptyMedifValues();
    for (const id of ids) values = setMedifFieldValue(values, id, 'ÁÉÍÓÚÑÜ gypq');
    const bytes = await createMedifPdf(template, values, emptyMedifPreferences(), 'editable');
    if (process.env.MEDIF_QA_PDF)
      writeFileSync(`${process.env.MEDIF_QA_PDF}.descenders.pdf`, bytes);
    const pdf = await PDFDocument.load(bytes);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (const id of ids) {
      const field = pdf.getForm().getTextField(id);
      expect(field.getText()).toBe('ÁÉÍÓÚÑÜ gypq');
      const widget = field.acroField.getWidgets()[0];
      const appearance = widget.getAppearances()?.normal;
      expect(appearance, `${id}: normal appearance stream`).toBeInstanceOf(PDFRawStream);
      if (!(appearance instanceof PDFRawStream)) throw new Error(`${id}: missing appearance`);
      const operators = Buffer.from(decodePDFRawStream(appearance).decode()).toString('latin1');
      const clipIndex = operators.indexOf('\nW\n');
      expect(clipIndex, `${id}: clipping operator`).toBeGreaterThan(0);
      // drawTextField emits the clipping polygon immediately before h/W/n.
      const clipPoints = operators
        .slice(0, clipIndex)
        .trimEnd()
        .split('\n')
        .slice(-5)
        .flatMap(line => {
          const point = /^([\d.-]+) ([\d.-]+) [ml]$/.exec(line);
          return point ? [[Number(point[1]), Number(point[2])]] : [];
        });
      expect(clipPoints, `${id}: clipping polygon`).toHaveLength(4);
      const bottom = Math.min(...clipPoints.map(point => point[1]));
      const top = Math.max(...clipPoints.map(point => point[1]));
      const left = Math.min(...clipPoints.map(point => point[0]));
      const right = Math.max(...clipPoints.map(point => point[0]));
      const fontSize = Number(/\/[^\s]+ ([\d.]+) Tf/.exec(operators)?.[1]);
      expect(fontSize, `${id}: appearance font size`).toBeGreaterThan(0);
      // Helvetica FontBBox is [-166, -225, 1000, 931]; Ascender 718 excludes capitals' accents.
      const ascent = (931 / 1000) * fontSize;
      const descent = (225 / 1000) * fontSize;
      const positions = [...operators.matchAll(/^1 0 0 1 ([\d.-]+) ([\d.-]+) Tm$/gm)];
      expect(positions, `${id}: actual text positions`).toHaveLength(1);
      for (const position of positions) {
        const x = Number(position[1]);
        const baseline = Number(position[2]);
        expect(baseline - descent, `${id}: descender below clipping path`).toBeGreaterThanOrEqual(
          bottom - 0.001
        );
        expect(baseline + ascent, `${id}: ascender above clipping path`).toBeLessThanOrEqual(
          top + 0.001
        );
        expect(x, `${id}: start outside clipping path`).toBeGreaterThanOrEqual(left - 0.001);
        expect(
          x + font.widthOfTextAtSize('ÁÉÍÓÚÑÜ gypq', fontSize),
          `${id}: end outside clipping path`
        ).toBeLessThanOrEqual(right + 0.001);
      }
    }
  });

  it('leaves hidden responses and linked identities blank without mutating the draft', async () => {
    const values = sample();
    let prefs = setMedifFieldHidden(emptyMedifPreferences(), 'p1_nombre_pasajero', true);
    prefs = setMedifFieldHidden(prefs, 'p1_silla_no', true);
    const pdf = await PDFDocument.load(await createMedifPdf(template, values, prefs, 'editable'));
    for (const id of ['p1_nombre_pasajero', 'p2_nombre_paciente', 'p1_silla_si', 'p1_silla_no'])
      expect(pdf.getForm().getTextField(id).getText() || '').toBe('');
    expect(values.p1_nombre_pasajero).toBe('José Muñoz');
  });

  it('flattens only the printable copy and leaves the source interactive', async () => {
    const printed = await PDFDocument.load(
      await createMedifPdf(template, sample(), emptyMedifPreferences(), 'print')
    );
    expect(printed.getPageCount()).toBe(3);
    expect(printed.getForm().getFields()).toHaveLength(0);
    expect((await PDFDocument.load(template)).getForm().getFields()).toHaveLength(137);
  });

  it('rejects overflowing text instead of clipping clinical content', async () => {
    const values = setMedifFieldValue(
      emptyMedifValues(),
      'p2_diagnostico_actual',
      'texto '.repeat(500)
    );
    await expect(
      createMedifPdf(template, values, emptyMedifPreferences(), 'print')
    ).rejects.toThrow('no cabe');
  });

  it('reports unsupported characters before offering a PDF', async () => {
    const values = setMedifFieldValue(emptyMedifValues(), 'p1_nombre_pasajero', 'Paciente 🛫');
    await expect(
      createMedifPdf(template, values, emptyMedifPreferences(), 'print')
    ).rejects.toThrow('caracteres no compatibles');
  });

  it('rejects a different template', async () => {
    const other = await PDFDocument.create();
    other.addPage();
    await expect(
      createMedifPdf(await other.save(), emptyMedifValues(), emptyMedifPreferences(), 'print')
    ).rejects.toThrow('plantilla MEDIF');
  });
});
