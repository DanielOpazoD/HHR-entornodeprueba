// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CONSENTIMIENTO_FIELD_COORDS,
  ENCUESTA_FIELD_COORDS,
  SOLICITUD_FIELD_COORDS,
  fillConsentimientoForm,
  fillImagingEncuestaForm,
  fillImagingRequestForm,
} from '@/services/pdf/imagingRequestPdfService';
import { DataFactory } from '@/tests/factories/DataFactory';

const standardFontDataUrl = path.resolve('node_modules/pdfjs-dist/standard_fonts') + path.sep;

const syntheticPatients = [
  {
    patient: DataFactory.createMockPatient('R1', {
      patientName: 'Ana María de los Ángeles Valentina Rosa Elena de la Fuente Pakarati',
      firstName: 'Ana María de los Ángeles Valentina Rosa Elena',
      lastName: 'de la Fuente',
      secondLastName: 'Pakarati',
    }),
    printed: 'ANA MARÍA DE LOS ÁNGELES DE LA FUENTE PAKARATI',
  },
  {
    // Too long for any template at 10 pt: the line shrinks instead of running on.
    patient: DataFactory.createMockPatient('R2', {
      patientName: 'Maximiliano Bartolomé Constantino Fernando Rapahango Tepano Hereveri Teao',
      firstName: 'Maximiliano Bartolomé Constantino Fernando',
      lastName: 'Rapahango Tepano',
      secondLastName: 'Hereveri Teao',
    }),
    printed: 'MAXIMILIANO BARTOLOMÉ CONSTANTINO RAPAHANGO TEPANO HEREVERI TEAO',
  },
  {
    // Eloísa sent the whole name as given names: without a surname nothing is shortened.
    patient: DataFactory.createMockPatient('R4', {
      patientName: 'Ana María Josefa Soto Rojas',
      firstName: 'Ana María Josefa Soto Rojas',
      lastName: '',
      secondLastName: '',
    }),
    printed: 'ANA MARÍA JOSEFA SOTO ROJAS',
  },
];

const readTextItems = async (bytes: Uint8Array) => {
  const pdf = await getDocument({
    data: bytes,
    standardFontDataUrl,
    useWorkerFetch: false,
  }).promise;
  const content = await (await pdf.getPage(1)).getTextContent();
  return content.items.flatMap(item =>
    'str' in item ? [{ text: item.str, x: item.transform[4], width: item.width }] : []
  );
};

describe('imaging request PDFs · patient fields', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (templatePath: string) => {
        const bytes = readFileSync(path.resolve('public', templatePath.replace(/^\//, '')));
        return new Response(new Uint8Array(bytes));
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['solicitud', fillImagingRequestForm, SOLICITUD_FIELD_COORDS.nombreCompleto],
    ['encuesta', fillImagingEncuestaForm, ENCUESTA_FIELD_COORDS.nombreCompleto],
    ['consentimiento', fillConsentimientoForm, CONSENTIMIENTO_FIELD_COORDS.nombreCompleto],
  ])(
    'prints the %s name on one line inside its field, first three given names only',
    async (_document, fill, field) => {
      for (const { patient, printed } of syntheticPatients) {
        const items = await readTextItems(await fill(patient, 'Dra. Sintética Prueba'));
        const nameItems = items.filter(item => /ANA|MAXIMILIANO|TEPANO|PAKARATI/.test(item.text));

        expect(nameItems.map(item => item.text)).toEqual([printed]);
        expect(nameItems[0].x).toBeCloseTo(field.x, 1);
        // pdf.js counts each space about 0.5 pt wider than Helvetica's metrics, hence the 2 %.
        expect(nameItems[0].width).toBeLessThanOrEqual(field.maxWidth * 1.02);
      }
    }
  );

  it('generates all three documents when the diagnosis spans several lines', async () => {
    const patient = DataFactory.createMockPatient('R3', {
      patientName: 'Tiare Rapu',
      pathology: 'Neumonía\nControl radiológico',
    });

    for (const fill of [fillImagingRequestForm, fillImagingEncuestaForm, fillConsentimientoForm]) {
      const items = await readTextItems(await fill(patient, 'Dra. Sintética Prueba'));
      expect(items.map(item => item.text)).toEqual(
        expect.arrayContaining(['NEUMONÍA', 'CONTROL RADIOLÓGICO'])
      );
    }
  });
});
