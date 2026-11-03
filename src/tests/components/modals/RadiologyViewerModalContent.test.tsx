import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { RadiologyViewerResults } from '@/components/modals/RadiologyViewerModalContent';
import { RadiologyPortalReceiptPreview } from '@/components/modals/RadiologyPortalReceiptPreview';
import type { MMRADSearchResult } from '@/services/radiology/mmradService';

const buildResult = (): MMRADSearchResult => ({
  rut: '11111111-1',
  examenes: [
    {
      nombre_examen: 'TC TORAX',
      fecha_examen: '12/04/2026 11:47',
      fecha_asignacion: '12/04/2026 12:00',
      mod: 'CT',
      estado: 'Validado',
      pdf_url: 'https://example.com/report.pdf',
      dicom_url: null,
      informe_html_url: 'https://example.com/report.html',
      portal_web_receipt_url: 'https://example.com/portal-receipt.html',
      report: {
        title: 'TOMOGRAFÍA SIMPLE DE TÓRAX',
        technique: null,
        antecedentesClinicos: null,
        findings: 'Hallazgo de prueba.',
        impression: 'Impresión de prueba.',
      },
    },
  ],
});

describe('RadiologyViewerModalContent', () => {
  it('shows copied state for the matching CT exam action', () => {
    const result = buildResult();

    render(
      <RadiologyViewerResults
        result={result}
        isLoading={false}
        modalities={['CT']}
        activeModTab="CT"
        filteredExams={result.examenes}
        onTabChange={vi.fn()}
        onOpenPdf={vi.fn()}
        onOpenPortalReceipt={vi.fn()}
        onCopyReport={vi.fn()}
        copiedReportExamKey="https://example.com/report.html"
      />
    );

    expect(screen.getByRole('button', { name: /copiado/i })).toBeInTheDocument();
  });

  it('delegates PDF open and copy actions for CT exams with structured reports', () => {
    const result = buildResult();
    const onOpenPdf = vi.fn();
    const onOpenPortalReceipt = vi.fn();
    const onCopyReport = vi.fn();

    render(
      <RadiologyViewerResults
        result={result}
        isLoading={false}
        modalities={['CT']}
        activeModTab="CT"
        filteredExams={result.examenes}
        onTabChange={vi.fn()}
        onOpenPdf={onOpenPdf}
        onOpenPortalReceipt={onOpenPortalReceipt}
        onCopyReport={onCopyReport}
        copiedReportExamKey={null}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /ver pdf/i }));
    fireEvent.click(screen.getByRole('button', { name: /comprobante portal/i }));
    fireEvent.click(screen.getByRole('button', { name: /copiar informe/i }));

    expect(onOpenPdf).toHaveBeenCalledWith(result.examenes[0]);
    expect(onOpenPortalReceipt).toHaveBeenCalledWith(result.examenes[0]);
    expect(onCopyReport).toHaveBeenCalledWith(result.examenes[0]);
  });

  it.each([
    [
      'https://ris.mmrad.cl/group/hhangaroa/examenes?p_p_id=2_WAR_ingradteleradexamenportlet_INSTANCE_Ab12' +
        '&_2_WAR_ingradteleradexamenportlet_INSTANCE_Ab12__spage=%2Fportlet_action%2Fexamen%2Fabrirestudio' +
        '&_2_WAR_ingradteleradexamenportlet_INSTANCE_Ab12_idexamen=123',
      'Visualizador Universitas',
    ],
    [
      'https://ris.mmrad.cl/ingrad-ris-informehtml/UtilServlet?a=3&u=1&idexamen=123&idprestacion=0',
      'Visualizador DICOM HTML5',
    ],
  ])('names the external viewer that MMRAD opens for %s', (dicomUrl, label) => {
    const result = buildResult();
    const exams = [{ ...result.examenes[0], dicom_url: dicomUrl }];

    render(
      <RadiologyViewerResults
        result={{ ...result, examenes: exams }}
        isLoading={false}
        modalities={['CT']}
        activeModTab="CT"
        filteredExams={exams}
        onTabChange={vi.fn()}
        onOpenPdf={vi.fn()}
        onOpenPortalReceipt={vi.fn()}
        onCopyReport={vi.fn()}
        copiedReportExamKey={null}
      />
    );

    expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', dicomUrl);
  });

  it('marks an exam MMRAD registered with another check digit and an incomplete check', () => {
    const result = buildResult();
    const exams = [{ ...result.examenes[0], registered_patient_id: '11111111-7' }];

    render(
      <RadiologyViewerResults
        result={{ ...result, examenes: exams, check_digit_search: 'partial' }}
        isLoading={false}
        modalities={['CT']}
        activeModTab="CT"
        filteredExams={exams}
        onTabChange={vi.fn()}
        onOpenPdf={vi.fn()}
        onOpenPortalReceipt={vi.fn()}
        onCopyReport={vi.fn()}
        copiedReportExamKey={null}
      />
    );

    expect(
      screen.getByText(/MMRAD registró este examen con el RUT 11\.111\.111-7, que difiere solo/)
    ).toBeInTheDocument();
    expect(screen.getByText(/No se pudo revisar si MMRAD tiene exámenes/)).toBeInTheDocument();
  });

  it('renders portal receipt in a floating preview and prints the iframe from a React button', () => {
    const focus = vi.fn();
    const print = vi.fn();

    render(
      <RadiologyPortalReceiptPreview
        title="Comprobante portal"
        html="<html><body><table><tr><td>Datos del paciente</td></tr></table></body></html>"
        onClose={vi.fn()}
      />
    );

    const iframe = screen.getByTitle(/comprobante portal web paciente/i) as HTMLIFrameElement;
    Object.defineProperty(iframe, 'contentWindow', {
      value: { focus, print },
      configurable: true,
    });

    fireEvent.click(screen.getByRole('button', { name: /imprimir/i }));

    expect(iframe).toHaveAttribute('srcdoc', expect.stringContaining('Datos del paciente'));
    expect(focus).toHaveBeenCalledTimes(1);
    expect(print).toHaveBeenCalledTimes(1);
  });
});
