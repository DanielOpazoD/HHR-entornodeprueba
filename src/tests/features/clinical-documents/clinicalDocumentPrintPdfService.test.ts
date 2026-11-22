import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildClinicalDocumentPrintHtml } from '@/features/clinical-documents/services/clinicalDocumentPrintHtmlBuilder';

describe('clinicalDocumentPrintPdfService', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="clinical-document-sheet" class="clinical-document-sheet">
        <img alt="Logo institucional izquierdo" src="/images/logos/logo_HHR.png" />
        <div class="clinical-document-section-block">
          <button class="clinical-document-inline-action">Editar</button>
          <button class="clinical-document-section-drag-handle">Drag</button>
          <input value="Paciente Test" />
        </div>
        <img alt="Logo institucional derecho" src="/images/logos/logo_SSMO.jpg" />
      </div>
    `;

    Object.defineProperty(window, 'getComputedStyle', {
      configurable: true,
      value: vi.fn(() => ({
        fontFamily: "Inter, 'Segoe UI', Roboto, Arial, sans-serif",
      })),
    });
  });

  it('builds printable html without inline actions and keeps letter page style', async () => {
    const html = await buildClinicalDocumentPrintHtml({
      pageTitle: 'Epicrisis médica',
      documentType: 'epicrisis',
    });

    expect(html).toContain('@page { size: letter; margin: 8mm; }');
    expect(html).not.toContain('clinical-document-inline-action');
    expect(html).not.toContain('clinical-document-section-drag-handle');
    expect(html).toContain('Firma paciente/familiar responsable');
  });

  it('omits patient signature footer for non-epicrisis document types', async () => {
    const html = await buildClinicalDocumentPrintHtml({
      pageTitle: 'Evolución clínica',
      documentType: 'evolucion',
    });

    expect(html).toContain('@page { size: letter; margin: 8mm; }');
    expect(html).not.toContain('Firma paciente/familiar responsable');
  });

  it('omits patient signature footer when the document disables it', async () => {
    const html = await buildClinicalDocumentPrintHtml({
      pageTitle: 'Epicrisis médica',
      documentType: 'epicrisis',
      includePatientSignature: false,
    });

    expect(html).not.toContain('Firma paciente/familiar responsable');
  });
});
