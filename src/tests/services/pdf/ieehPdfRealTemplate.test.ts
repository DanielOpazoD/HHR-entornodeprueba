// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fillIEEHForm } from '@/services/pdf/ieehPdfService';
import { DataFactory } from '@/tests/factories/DataFactory';

const patient = DataFactory.createMockPatient('R1', {
  patientName: 'ANA PEREZ SOTO',
  rut: '11.111.111-1',
  admissionDate: '2026-10-18',
  pathology: 'DIAGNOSTICO BASE',
  cie10Description: 'DIAGNOSTICO DEL CENSO',
  cie10Code: 'A00',
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('IEEH generated PDF using the real template', () => {
  it.each([
    {
      name: 'patient diagnosis fallback',
      discharge: {},
      expectedDiagnosis: 'DIAGNOSTICO DEL CENSO',
      expectedCode: 'A00',
      absentDiagnosis: 'DIAGNOSTICO BASE',
    },
    {
      name: 'discharge diagnosis override',
      discharge: { diagnosticoPrincipal: 'DIAGNOSTICO DE ALTA', cie10Code: 'B00' },
      expectedDiagnosis: 'DIAGNOSTICO DE ALTA',
      expectedCode: 'B00',
      absentDiagnosis: 'DIAGNOSTICO DEL CENSO',
    },
  ])('prints patient identity and $name', async testCase => {
    const templateBytes = await readFile(
      resolve(process.cwd(), 'public/docs/estadistico-egreso.pdf')
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(url).toBe('/docs/estadistico-egreso.pdf');
        return new Response(new Uint8Array(templateBytes), { status: 200 });
      })
    );

    const bytes = await fillIEEHForm(patient, testCase.discharge);
    const loadingTask = getDocument({ data: bytes, useSystemFonts: true });
    try {
      const pdf = await loadingTask.promise;
      const page = await pdf.getPage(1);
      const content = await page.getTextContent();
      const text = content.items
        .filter(item => 'str' in item)
        .map(item => item.str)
        .join('')
        .replace(/\s+/g, '');

      expect(text).toContain('ANA');
      expect(text).toContain('PEREZ');
      expect(text).toContain('SOTO');
      expect(text).toContain('11.111.111-1');
      expect(text).toContain(testCase.expectedDiagnosis.replace(/\s+/g, ''));
      expect(text).toContain(testCase.expectedCode);
      expect(text).not.toContain(testCase.absentDiagnosis.replace(/\s+/g, ''));
    } finally {
      await loadingTask.destroy();
    }
  });
});
