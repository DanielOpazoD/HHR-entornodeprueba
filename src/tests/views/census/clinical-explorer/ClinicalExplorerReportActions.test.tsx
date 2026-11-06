import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicalExplorerReportActions } from '@/features/census/components/clinical-explorer/ClinicalExplorerReportActions';
import { downloadBlob } from '@/services/exporters/exportDownload';
import type { MMRADExam } from '@/services/radiology/mmradService';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';

vi.unmock('@/services/radiology/mmradService');
vi.mock('@/services/auth/authRequestHeaders', () => ({
  resolveCurrentUserAuthHeaders: vi
    .fn()
    .mockResolvedValue({ Authorization: 'Bearer synthetic-token' }),
}));
vi.mock('@/services/exporters/exportDownload', () => ({ downloadBlob: vi.fn() }));

const exam: MMRADExam = {
  nombre_examen: 'TC tórax',
  fecha_examen: '02/11/2026 09:40',
  fecha_asignacion: '02/11/2026',
  mod: 'CT',
  estado: 'Validado',
  pdf_url: 'https://mmrad.example/pdf/synthetic',
  dicom_url: null,
  informe_html_url: null,
  report: {
    title: 'TC de tórax',
    technique: 'Técnica sintética que no se copia.',
    antecedentesClinicos: 'Antecedente sintético que no se copia.',
    findings: 'Sin condensaciones.\nSin derrame.',
    impression: 'Sin hallazgos agudos.',
  },
};

const downloadButton = () => screen.getByRole('button', { name: 'Descargar PDF original' });
const copyButton = () => screen.getByRole('button', { name: 'Copiar hallazgos e impresión' });
const readBlobText = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });

describe('ClinicalExplorerReportActions', () => {
  const fetchPdf = vi.fn();
  const writeText = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchPdf.mockReset();
    writeText.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', fetchPdf);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
  });

  afterEach(() => {
    act(() => setSessionGeneration(null));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('copies the study, findings and impression privately, omitting technique and history', async () => {
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    const previousCapture: unknown = Reflect.get(window, '__HHR_LAST_CLIPBOARD__');
    render(<ClinicalExplorerReportActions exam={exam} />);
    expect(copyButton().textContent).toBe('');
    expect(downloadButton().textContent).toBe('');
    fireEvent.click(copyButton());

    expect(await screen.findByRole('status')).toHaveTextContent('Copiado');
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      'TAC de Tórax (02-11-2026).\n\nHallazgos: Sin condensaciones. Sin derrame.\n\nImpresión: Sin hallazgos agudos.'
    );
    expect(storageWrite).not.toHaveBeenCalled();
    expect(Reflect.get(window, '__HHR_LAST_CLIPBOARD__')).toBe(previousCapture);
  });

  it('disables both actions during copying and shows a safe failure if the clipboard rejects', async () => {
    let rejectCopy: (error: Error) => void = () => {};
    writeText.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectCopy = reject;
      })
    );
    render(<ClinicalExplorerReportActions exam={exam} />);
    fireEvent.click(copyButton());
    expect(copyButton()).toBeDisabled();
    expect(downloadButton()).toBeDisabled();
    await act(async () => rejectCopy(new Error('private underlying exception')));

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo copiar el informe.');
    expect(screen.queryByText(/private underlying exception/)).toBeNull();
    expect(copyButton()).toBeEnabled();
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it('downloads the authenticated original PDF bytes once without generating a report', async () => {
    const original = new Blob(['%PDF-1.7\nSynthetic original bytes\n%%EOF'], {
      type: 'application/pdf',
    });
    let resolvePdf: (blob: Blob) => void = () => {};
    fetchPdf.mockResolvedValueOnce({
      ok: true,
      blob: () =>
        new Promise<Blob>(resolve => {
          resolvePdf = resolve;
        }),
    });
    render(<ClinicalExplorerReportActions exam={exam} />);
    fireEvent.click(downloadButton());
    fireEvent.click(downloadButton());
    expect(downloadButton()).toBeDisabled();
    expect(copyButton()).toBeDisabled();
    await waitFor(() => expect(fetchPdf).toHaveBeenCalledTimes(1));
    await act(async () => resolvePdf(original));

    expect(downloadBlob).toHaveBeenCalledExactlyOnceWith(original, 'Informe-TAC.pdf');
    expect(await readBlobText(vi.mocked(downloadBlob).mock.calls[0]![0])).toBe(
      '%PDF-1.7\nSynthetic original bytes\n%%EOF'
    );
    expect(fetchPdf).toHaveBeenCalledWith(
      expect.stringContaining('/.netlify/functions/mmrad-search?action=pdf&link='),
      expect.objectContaining({
        headers: { Authorization: 'Bearer synthetic-token' },
        signal: expect.any(AbortSignal),
      })
    );
    expect(writeText).not.toHaveBeenCalled();
  });

  it('keeps the original PDF action disabled when MMRAD has no original link', () => {
    render(<ClinicalExplorerReportActions exam={{ ...exam, pdf_url: null }} />);
    expect(downloadButton()).toBeDisabled();
    expect(downloadButton()).toHaveAttribute('title', 'PDF original no disponible');
    fireEvent.click(downloadButton());
    expect(fetchPdf).not.toHaveBeenCalled();
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it('does not deliver an HTML response advertised as a successful PDF request', async () => {
    fetchPdf.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob(['private html'], { type: 'text/html' })),
    });
    render(<ClinicalExplorerReportActions exam={exam} />);
    fireEvent.click(downloadButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo descargar el PDF original.'
    );
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(screen.queryByText(/private html/)).toBeNull();
  });

  it('silently cancels a pending original when the report unmounts', async () => {
    let resolvePdf: (blob: Blob) => void = () => {};
    fetchPdf.mockResolvedValueOnce({
      ok: true,
      blob: () =>
        new Promise<Blob>(resolve => {
          resolvePdf = resolve;
        }),
    });
    const view = render(<ClinicalExplorerReportActions exam={exam} />);
    fireEvent.click(downloadButton());
    await waitFor(() => expect(fetchPdf).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(fetchPdf.mock.calls[0]![1].signal.aborted).toBe(true);
    await act(async () => resolvePdf(new Blob(['original'], { type: 'application/pdf' })));
    expect(downloadBlob).not.toHaveBeenCalled();
  });
});
