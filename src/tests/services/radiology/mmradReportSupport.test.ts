import { describe, expect, it } from 'vitest';
import {
  buildMMRADPortalReceiptPrintHtml,
  buildMMRADReportClipboardText,
  parseMMRADReportSections,
} from '@/services/radiology/mmradReportSupport';

describe('mmradReportSupport', () => {
  const reportHtml = `
    <html>
      <body>
        <h1>TOMOGRAFÍA SIMPLE DE TÓRAX</h1>
        <p><strong>TECNICA:</strong></p>
        <p>Se realiza tomografía computada simple de tórax.</p>
        <p><strong>ANTECEDENTES CLINICOS:</strong></p>
        <p>dolor en torax</p>
        <p><strong>HALLAZGOS:</strong></p>
        <p>Parénquima pulmonar sin consolidaciones.</p>
        <p><strong>IMPRESION:</strong></p>
        <p>Cardiomegalia.</p>
      </body>
    </html>
  `;

  it('parses CT report sections from html', () => {
    const parsed = parseMMRADReportSections(reportHtml);

    expect(parsed).toEqual({
      title: 'TOMOGRAFÍA SIMPLE DE TÓRAX',
      technique: 'Se realiza tomografía computada simple de tórax.',
      antecedentesClinicos: 'dolor en torax',
      findings: 'Parénquima pulmonar sin consolidaciones.',
      impression: 'Cardiomegalia.',
    });
  });

  it('builds clipboard text with findings and impression only', () => {
    const text = buildMMRADReportClipboardText({
      examName: 'TC TORAX',
      examDate: '12/04/2026 11:47',
      title: 'TOMOGRAFÍA SIMPLE DE TÓRAX',
      findings: 'Hallazgo A\nHallazgo B',
      impression: 'Impresión B\nImpresión C',
    });

    expect(text).toBe(
      'TAC de Tórax (12-04-2026).\n\nHallazgos: Hallazgo A Hallazgo B\n\nImpresión: Impresión B Impresión C'
    );
  });

  it('normalizes multiline sections into continuous paragraphs while preserving the study heading', () => {
    const text = buildMMRADReportClipboardText({
      examName: 'TC TORAX',
      examDate: '09/04/2026 13:05',
      title: 'TOMOGRAFÍA SIMPLE DE TÓRAX',
      findings: 'Parénquima pulmonar.\nTráquea central.',
      impression: 'Cardiomegalia.\nAteromatosis.',
    });

    expect(text).toBe(
      'TAC de Tórax (09-04-2026).\n\nHallazgos: Parénquima pulmonar. Tráquea central.\n\nImpresión: Cardiomegalia. Ateromatosis.'
    );
  });

  it('stops parsing impression before signature and embedded print script', () => {
    const parsed = parseMMRADReportSections(`
      <html>
        <body>
          <h1>TOMOGRAFÍA SIMPLE DE TÓRAX</h1>
          <p><strong>HALLAZGOS:</strong></p>
          <p>Parénquima pulmonar sin consolidaciones.</p>
          <p><strong>IMPRESION:</strong></p>
          <p>Cardiomegalia.</p>
          <p>Saluda Atentamente</p>
          <p>DR. OMAR DUQUE</p>
          <p>09-04-2026 13:05</p>
          <p>Imprimir</p>
          <p>save pdf</p>
          <p>var testDivElement = document.getElementById('content2');</p>
          <p>function savePDF() {</p>
        </body>
      </html>
    `);

    expect(parsed?.findings).toBe('Parénquima pulmonar sin consolidaciones.');
    expect(parsed?.impression).toBe('Cardiomegalia.');
  });

  it('builds portal receipt print html without inline script or inline click handlers', () => {
    const html = buildMMRADPortalReceiptPrintHtml(`
      <button onclick="window.print()">Imprimir</button>
      <script>window.print()</script>
      <table><tr><td>Datos del paciente</td></tr></table>
    `);

    expect(html).toContain('Datos del paciente');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onclick=/i);
    expect(html).not.toContain('mmrad-print-toolbar');
  });

  it('removes the native MMRAD print button from the portal receipt preview', () => {
    const html = buildMMRADPortalReceiptPrintHtml(`
      <div style="background:#333;text-align:center">
        <button type="button">Imprimir</button>
      </div>
      <table><tr><td>Clave Portal Imagenologia</td><td>9DJRTL51</td></tr></table>
    `);

    expect(html).toContain('Clave Portal Imagenologia');
    expect(html).toContain('9DJRTL51');
    expect(html).not.toMatch(/<button\b/i);
  });
});
