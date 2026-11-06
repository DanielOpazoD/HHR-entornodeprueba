import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PDFDocument } from 'pdf-lib';
import PizZip from 'pizzip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditDocumentsResult } from '@/features/audit-documents/eloisa-history';

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  auditCancel: vi.fn(),
  lab: vi.fn(),
  search: vi.fn(),
  checkDigit: vi.fn(),
  pdf: vi.fn(),
  download: vi.fn(),
  health: vi.fn(),
  joinGate: null as Promise<void> | null,
}));

vi.mock('@/features/audit-documents/eloisa-history', () => ({
  requestAuditDocuments: (...args: unknown[]) => mocks.audit(...args),
}));
vi.mock('@/features/rayen-import/clinical-panel', async importOriginal => ({
  ...(await importOriginal<typeof import('@/features/rayen-import/clinical-panel')>()),
  requestRayenExtensionHealth: (...args: unknown[]) => mocks.health(...args),
}));
vi.mock('@/features/laboratory/hospitalization-reports', () => ({
  useSyslabHospitalizationReports: (params: unknown) => mocks.lab(params),
}));
vi.mock('@/services/radiology/mmradService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/radiology/mmradService')>();
  return {
    ...actual,
    searchMMRADExams: (...args: unknown[]) => mocks.search(...args),
    searchMMRADCheckDigitExams: (...args: unknown[]) => mocks.checkDigit(...args),
    fetchMMRADPdfBlob: (...args: unknown[]) => mocks.pdf(...args),
  };
});
vi.mock('@/services/exporters/exportDownload', () => ({
  downloadBlob: (...args: unknown[]) => mocks.download(...args),
}));
// The real pdf-lib, behind a gate a test can hold to act while the PDF is being joined.
vi.mock('@/services/pdf/pdfLibRuntime', () => ({
  loadPdfLibGenerationRuntime: async () => {
    await mocks.joinGate;
    return import('pdf-lib');
  },
}));

import { ClinicalExplorerHeader } from '@/features/census/components/clinical-explorer/ClinicalExplorerHeader';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';

import {
  HISTORY_NAME,
  RUT,
  analysis,
  ctExam,
  okRecord,
  openDialog,
  patient,
  readBytes,
  renderHeader,
  syntheticPdf,
  xRay,
} from './clinicalExplorerDownload.testSupport';

const downloadedWidths = async (): Promise<number[]> => {
  const [blob] = mocks.download.mock.calls[0] as [Blob, string];
  const doc = await PDFDocument.load(await readBytes(blob));
  return doc.getPages().map(page => Math.round(page.getWidth()));
};

const auditAnswers = (result: Promise<AuditDocumentsResult>) =>
  mocks.audit.mockReturnValue({ result, cancel: mocks.auditCancel });

describe('ClinicalExplorerDownloadDialog: one patient, one episode', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.joinGate = null;
    // 01:30 on 7 November in Santiago is still 6 November at the hospital (TIME-02).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-07T04:30:00Z'));
    auditAnswers(okRecord());
    mocks.lab.mockReturnValue({
      phase: 'ready',
      analysis,
      pending: 0,
      exams: [],
      pendingLinks: [],
      message: '',
      progress: null,
    });
    mocks.health.mockReset().mockResolvedValue({
      report: { version: '0.48.74', protocolVersion: 5, checkedAt: '2026-11-04T12:00:00Z' },
    });
    mocks.search.mockResolvedValue({ rut: RUT, examenes: [ctExam, xRay] });
    mocks.checkDigit.mockResolvedValue({ rut: RUT, examenes: [], check_digit_search: 'complete' });
    const ct = await syntheticPdf(300);
    mocks.pdf.mockResolvedValue(new Blob([ct], { type: 'application/pdf' }));
  });

  afterEach(() => {
    act(() => setSessionGeneration(null));
    vi.useRealTimers();
  });

  it('checks the extension version first and never starts an old one that saves on its own', async () => {
    mocks.health.mockResolvedValue({
      report: { version: '0.48.65', protocolVersion: 5, checkedAt: '2026-11-04T12:00:00Z' },
    });
    renderHeader();
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Descargar' }));

    expect(await within(dialog).findByRole('alert')).toBeVisible();
    expect(within(dialog).getByRole('list', { name: 'Avance de la descarga' })).toHaveTextContent(
      'La extensión Eloísa v0.48.65 no puede entregar la ficha a esta página. Actualízala a la versión 0.48.71 o superior para incluirla.'
    );
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('leaves the record out when two stays start on the admission day, and says why', async () => {
    const zip = new PizZip();
    const second = HISTORY_NAME.replace('.pdf', ' (2).pdf');
    zip.file(
      '00 Resumen.csv',
      '\uFEFFRUT;Nombre;Ingreso;Egreso;Documento;Resultado;Archivo\r\n' +
        `12.345.678-5;PACIENTE SINTÉTICO;2026-11-01;En curso;Historial de hospitalización;Descargado;${HISTORY_NAME}\r\n` +
        `12.345.678-5;PACIENTE SINTÉTICO;2026-11-01;2026-11-04;Historial de hospitalización;Descargado;${second}\r\n`
    );
    zip.file(HISTORY_NAME, await syntheticPdf(100), { binary: true });
    zip.file(second, await syntheticPdf(110), { binary: true });
    const archive = new Blob([zip.generate({ type: 'uint8array' })], { type: 'application/zip' });
    auditAnswers(Promise.resolve({ ...(await okRecord()), archive }));
    renderHeader();
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Descargar' }));

    expect(await within(dialog).findByRole('alert')).toBeVisible();
    expect(within(dialog).getByRole('list', { name: 'Avance de la descarga' })).toHaveTextContent(
      /2 hospitalizaciones de este RUT que empiezan el 01-11-2026/
    );
    expect(mocks.download).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Descargar lo disponible' }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(1));
    // Neither history goes in: only the lab results and the CT report.
    expect(await downloadedWidths()).toEqual([595, 300]);
  });

  it('stops and closes when the RUN of the patient in the bed is corrected mid-run', async () => {
    auditAnswers(new Promise(() => undefined));
    const view = renderHeader();
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Descargar' }));
    await waitFor(() => expect(mocks.audit).toHaveBeenCalledTimes(1));

    const corrected = { ...patient!, data: { ...patient!.data, rut: '11.111.111-1' } };
    view.rerender(
      <ClinicalExplorerHeader
        patient={corrected}
        onRequestExams={vi.fn()}
        censusDate="2026-11-06"
        indicationDate={null}
      />
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.auditCancel).toHaveBeenCalledTimes(1);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('leaves out CT studies after a past census day: they may belong to a later stay', async () => {
    render(
      <ClinicalExplorerHeader
        patient={patient!}
        onRequestExams={vi.fn()}
        censusDate="2026-11-02"
        indicationDate={null}
      />
    );
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Descargar' }));

    expect(await within(dialog).findByRole('alert')).toBeVisible();
    expect(within(dialog).getByRole('list', { name: 'Avance de la descarga' })).toHaveTextContent(
      /Posteriores al 02-11-2026: TC tórax \(03-11-2026 10:15\)\. No van incluidos/
    );
    expect(mocks.pdf).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
  });
});
