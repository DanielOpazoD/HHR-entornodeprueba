// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fillMedicalIndicationsPdf,
  type MedicalIndicationsPdfData,
} from '@/services/pdf/medicalIndicationsPdfService';

const TEMPLATE_FILE = 'indicaciones medicas y plan de enfermreia.pdf';

const baseData: MedicalIndicationsPdfData = {
  paciente_nombre: 'PACIENTE SINTETICO',
  paciente_rut: '12.345.678-5',
  paciente_diagnostico: 'DIAGNOSTICO DE PRUEBA',
  paciente_edad: '41',
  fecha_nacimiento: '01-01-1985',
  paciente_alergias: 'NO CONOCIDAS',
  medicotratante: 'EQUIPO DE PRUEBA',
  fecha_ingreso: '2026-11-18',
  fecha_actual: '19-11-2026',
  fecha_generacion: '19-11-2026, 10:00',
  diasEstada: '2',
  Reposoindicacion: 'REPOSO DE PRUEBA',
  Regimenindicacion: 'REGIMEN DE PRUEBA',
  Kinemotora: '',
  Kinerespiratoria: '',
  Kinecantidadvecesdia: '',
  Pendientes: 'NOTA DE PRUEBA',
  indicaciones: [],
};

const series = (count: number) =>
  Array.from({ length: count }, (_, index) => `Serie ${String(index + 1).padStart(2, '0')}`);

const compact = (text: string) => text.replace(/\s+/g, '');

/** The text pdf.js reads from each page of the generated PDF, without spaces. */
const readPages = async (bytes: Uint8Array): Promise<string[]> => {
  const loadingTask = getDocument({ data: bytes, useSystemFonts: true });
  try {
    const pdf = await loadingTask.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const content = await (await pdf.getPage(pageNumber)).getTextContent();
      pages.push(
        compact(
          content.items
            .filter(item => 'str' in item)
            .map(item => item.str)
            .join('')
        )
      );
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
};

const printWithRealTemplate = async (indicaciones: string[]) => {
  const templateBytes = await readFile(resolve(process.cwd(), 'Formularios', TEMPLATE_FILE));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      expect(decodeURIComponent(String(url))).toContain(TEMPLATE_FILE);
      return new Response(new Uint8Array(templateBytes), { status: 200 });
    })
  );
  return readPages(await fillMedicalIndicationsPdf({ ...baseData, indicaciones }));
};

/** Position of each numbered indication in the printed text, or -1 when it is missing. */
const positionsOf = (text: string, indications: string[]) =>
  indications.map((indication, index) => text.indexOf(compact(`${index + 1}. ${indication}`)));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('medical indications PDF on the official form', () => {
  it('prints fifteen short indications on the single indications sheet', async () => {
    const indications = series(15);
    const pages = await printWithRealTemplate(indications);

    expect(pages).toHaveLength(2);
    const positions = positionsOf(pages[0], indications);
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(pages[0]).not.toContain('Hoja');
  });

  it('continues on a second indications sheet instead of dropping what does not fit', async () => {
    const indications = series(15);
    indications[0] = 'Indicación extensa de prueba. '.repeat(5).trim();
    const pages = await printWithRealTemplate(indications);

    // Indications sheet, its continuation, then the nursing plan page of the form.
    expect(pages).toHaveLength(3);
    const indicationsText = pages[0] + pages[1];
    const missing = indications.filter(
      (indication, index) => !indicationsText.includes(compact(`${index + 1}. ${indication}`))
    );
    expect(missing).toEqual([]);
    const positions = positionsOf(indicationsText, indications);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(pages[1]).toContain(compact(`14. ${indications[13]}`));
    expect(pages[1]).toContain(compact(`15. ${indications[14]}`));

    expect(pages[0]).toContain(compact('Hoja 1 de 2'));
    expect(pages[1]).toContain(compact('Hoja 2 de 2'));
    expect(pages[1]).toContain(compact(baseData.paciente_nombre));
    expect(pages[1]).toContain(baseData.paciente_rut);
    expect(pages[1]).not.toContain(compact(baseData.Reposoindicacion));
    expect(pages[2]).toContain(compact('PLANIFICACIÓN DE CUIDADOS'));
  });
});
