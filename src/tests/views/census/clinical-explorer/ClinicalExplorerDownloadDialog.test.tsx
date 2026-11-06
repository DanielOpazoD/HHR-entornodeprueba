import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PDFDocument } from 'pdf-lib';
import PizZip from 'pizzip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditDocumentsResult } from '@/features/audit-documents/eloisa-history';
import type { MMRADExam } from '@/services/radiology/mmradService';
import type { LabAnalysisData } from '@/types/domain/labAnalyticsTypes';

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  auditCancel: vi.fn(),
  lab: vi.fn(),
  search: vi.fn(),
  checkDigit: vi.fn(),
  pdf: vi.fn(),
  download: vi.fn(),
  joinGate: null as Promise<void> | null,
}));

vi.mock('@/features/audit-documents/eloisa-history', () => ({
  requestAuditDocuments: (...args: unknown[]) => mocks.audit(...args),
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

import { BEDS } from '@/constants/beds';
import { ClinicalExplorerHeader } from '@/features/census/components/clinical-explorer/ClinicalExplorerHeader';
import { listClinicalExplorerPatients } from '@/features/census/controllers/clinicalExplorerController';
import { openMMRADExamListMemory } from '@/components/modals/controllers/radiologyExamListMemory';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { DataFactory } from '@/tests/factories/DataFactory';

const RUT = '12.345.678-5';
const [patient, otherPatient] = listClinicalExplorerPatients({
  visibleBeds: BEDS.filter(bed => !bed.isExtra),
  beds: {
    R1: DataFactory.createMockPatient('R1', {
      patientName: 'PACIENTE SINTÉTICO',
      rut: RUT,
      clinicalEpisodeId: 'ep-1',
      admissionDate: '2026-11-01',
    }),
    R2: DataFactory.createMockPatient('R2', {
      patientName: 'OTRO SINTÉTICO',
      rut: '5.844.865-6',
      clinicalEpisodeId: 'ep-2',
      admissionDate: '2026-11-03',
    }),
  },
});

/** A synthetic PDF whose page width tells which source it came from. */
const syntheticPdf = async (width: number): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  doc.addPage([width, 400]);
  return doc.save();
};

const readBytes = (blob: Blob): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });

const downloadedWidths = async (): Promise<number[]> => {
  const [blob] = mocks.download.mock.calls[0] as [Blob, string];
  const doc = await PDFDocument.load(await readBytes(blob));
  return doc.getPages().map(page => Math.round(page.getWidth()));
};

const HISTORY_NAME =
  'PACIENTE SINTETICO - 12345678-5 - Historial hospitalizacion - ingreso 2026-11-01.pdf';

const historyArchive = async (): Promise<Blob> => {
  const zip = new PizZip();
  zip.file('00 Resumen.csv', 'RUT;Nombre\r\n');
  zip.file(HISTORY_NAME, await syntheticPdf(100), { binary: true });
  return new Blob([zip.generate({ type: 'uint8array' })], { type: 'application/zip' });
};

const analysis: LabAnalysisData = {
  trendGroups: [],
  examDates: [],
  microbiologyEntries: [],
  comparison: {
    Creatinina: {
      '02/11/2026 08:30': {
        section: 'BIOQUIMICA',
        analysis: 'Creatinina',
        result: '1.1',
        unit: 'mg/dL',
        refValue: '0.7 - 1.3',
      },
    },
  },
};

const ctExam: MMRADExam = {
  nombre_examen: 'TC tórax',
  fecha_examen: '03/11/2026 10:15',
  fecha_asignacion: '03/11/2026',
  mod: 'CT',
  estado: 'Validado',
  pdf_url: 'https://mmrad.example/pdf/synthetic',
  dicom_url: null,
  informe_html_url: null,
  report: null,
};
const xRay: MMRADExam = { ...ctExam, nombre_examen: 'Rx tórax', mod: 'CR', pdf_url: 'rx' };

const auditAnswers = (result: Promise<AuditDocumentsResult>) =>
  mocks.audit.mockReturnValue({ result, cancel: mocks.auditCancel });

const okRecord = async (): Promise<AuditDocumentsResult> => ({
  ok: true,
  documentCount: 1,
  failedCount: 0,
  archive: await historyArchive(),
  summary: [
    {
      run: '123456785',
      name: 'PACIENTE SINTETICO',
      hospitalizations: 1,
      unverified: 0,
      downloaded: 1,
      reconstructed: 0,
      incomplete: 0,
      failed: 0,
    },
  ],
});

const renderHeader = (current = patient!) =>
  render(
    <ClinicalExplorerHeader
      patient={current}
      onRequestExams={vi.fn()}
      censusDate="2026-11-06"
      indicationDate={null}
    />
  );

const openDialog = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Descargar ficha, exámenes e informes' }));
  return screen.getByRole('dialog', { name: /Descargar ficha, exámenes e informes/ });
};

describe('ClinicalExplorerDownloadDialog', () => {
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
      message: '',
      progress: null,
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

  it('offers every part, the stay range on the hospital calendar and one joined PDF', () => {
    renderHeader();
    const dialog = openDialog();
    for (const name of [/Ficha clínica/, /Exámenes de sangre/, /Informes de TAC/]) {
      expect(within(dialog).getByRole('checkbox', { name })).toBeChecked();
    }
    expect(within(dialog).getByLabelText('Exámenes desde')).toHaveValue('2026-11-01');
    expect(within(dialog).getByLabelText('Exámenes hasta')).toHaveValue('2026-11-06');
    expect(within(dialog).getByRole('radio', { name: 'Un PDF unido' })).toBeChecked();

    fireEvent.change(within(dialog).getByLabelText('Exámenes desde'), {
      target: { value: '2026-11-08' },
    });
    expect(
      within(dialog).getByText('La fecha «desde» es posterior a la fecha «hasta».')
    ).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Descargar' })).toBeDisabled();
  });

  it('joins the Eloísa record, the Syslab results and the CT report, in that order', async () => {
    renderHeader();
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Descargar' }));

    await waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(1));
    expect(mocks.download.mock.calls[0]?.[1]).toBe(
      'PACIENTE SINTETICO - Ficha examenes e informes TAC - 2026-11-06.pdf'
    );
    // Ficha (100), the A4 results page HHR writes (595), then the original CT PDF (300).
    expect(await downloadedWidths()).toEqual([100, 595, 300]);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        patients: [{ run: '123456785', dateFrom: '2026-11-01', dateTo: '2026-11-06' }],
        documentTypes: ['history'],
      })
    );
    expect(mocks.lab).toHaveBeenCalledWith(
      expect.objectContaining({ rut: RUT, episodeId: 'ep-1', admissionDate: '2026-11-01' })
    );
    expect(mocks.search).toHaveBeenCalledWith(
      expect.objectContaining({ rut: RUT, dateFrom: '2026-11-01' })
    );
    expect(mocks.pdf).toHaveBeenCalledTimes(1);
    expect(await within(dialog).findByRole('status')).toHaveTextContent(
      'Descargado como «PACIENTE SINTETICO - Ficha examenes e informes TAC - 2026-11-06.pdf».'
    );
  });

  it('says which part failed and why, and downloads the rest only when asked', async () => {
    auditAnswers(
      Promise.resolve({
        ok: false,
        error: 'La extensión Eloísa no respondió. Actualízala y recarga esta página.',
      })
    );
    renderHeader();
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Descargar' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Falta parte de lo pedido. Puedes descargar lo disponible o volver a intentarlo.'
    );
    const progress = within(dialog).getByRole('list', { name: 'Avance de la descarga' });
    expect(progress).toHaveTextContent(
      'La extensión Eloísa no respondió. Actualízala y recarga esta página.'
    );
    expect(progress).toHaveTextContent('1 informe del 01-11-2026 al 06-11-2026');
    expect(mocks.download).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Descargar lo disponible' }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(1));
    expect(await downloadedWidths()).toEqual([595, 300]);
  });

  it('packs what was gathered in another format without asking the sources again', async () => {
    auditAnswers(Promise.resolve({ ok: false, error: 'La extensión Eloísa no respondió.' }));
    renderHeader();
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Descargar' }));
    await within(dialog).findByRole('alert');

    fireEvent.click(within(dialog).getByRole('radio', { name: 'Archivos separados (ZIP)' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Descargar lo disponible' }));

    await waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(1));
    const [blob, name] = mocks.download.mock.calls[0] as [Blob, string];
    expect(name).toMatch(/\.zip$/);
    expect(Object.keys(new PizZip(await readBytes(blob)).files)).toEqual([
      '2 PACIENTE SINTETICO - Examenes de laboratorio - 2026-11-01 a 2026-11-06.pdf',
      '3 PACIENTE SINTETICO - Informe TAC - 2026-11-03 - TC torax.pdf',
    ]);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.search).toHaveBeenCalledTimes(1);
  });

  it('names the CT report that did not come and writes the one MMRAD has only as text', async () => {
    const textOnly: MMRADExam = {
      ...ctExam,
      nombre_examen: 'TC cerebro',
      fecha_examen: '02/11/2026 18:00',
      pdf_url: null,
      report: {
        title: 'TC de cerebro',
        technique: null,
        antecedentesClinicos: null,
        findings: 'Hallazgo sintético.',
        impression: 'Impresión sintética.',
      },
    };
    const missing: MMRADExam = {
      ...ctExam,
      nombre_examen: 'TC abdomen',
      fecha_examen: '05/11/2026 09:00',
      pdf_url: 'https://mmrad.example/pdf/missing',
    };
    mocks.search.mockResolvedValue({ rut: RUT, examenes: [missing, ctExam, textOnly] });
    mocks.pdf.mockImplementation(async (url: string) => {
      if (url.endsWith('missing')) throw new Error('No se pudo obtener el PDF original de MMRAD.');
      return new Blob([await syntheticPdf(300)], { type: 'application/pdf' });
    });
    renderHeader();
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Descargar' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Falta parte de lo pedido/);
    expect(within(dialog).getByRole('list', { name: 'Avance de la descarga' })).toHaveTextContent(
      'No se pudo descargar: TC abdomen (05-11-2026 09:00).'
    );
    // Only the CT studies with an original PDF are asked to MMRAD; the text one is written here.
    expect(mocks.pdf.mock.calls.map(call => call[0])).toEqual([
      'https://mmrad.example/pdf/synthetic',
      'https://mmrad.example/pdf/missing',
    ]);
    expect(mocks.download).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Descargar lo disponible' }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(1));
    // Ficha, results, then the CT studies oldest first: the text report (A4) and the original.
    expect(await downloadedWidths()).toEqual([100, 595, 595, 300]);
  });

  it('tells a Syslab that asks for its session from one without reports', async () => {
    mocks.lab.mockReturnValue({
      phase: 'login-required',
      analysis: null,
      pending: 0,
      message: '',
      refreshing: false,
      progress: null,
    });
    renderHeader();
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Descargar' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Falta parte de lo pedido/);
    expect(within(dialog).getByRole('list', { name: 'Avance de la descarga' })).toHaveTextContent(
      'Syslab pide iniciar sesión.'
    );
    expect(mocks.download).not.toHaveBeenCalled();

    mocks.lab.mockReturnValue({
      phase: 'empty',
      analysis: null,
      pending: 0,
      message: '',
      refreshing: false,
      progress: null,
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Volver a intentar' }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(1));
    expect(within(dialog).getByRole('list', { name: 'Avance de la descarga' })).toHaveTextContent(
      'Sin informes de Syslab del 01-11-2026 al 06-11-2026.'
    );
    expect(await downloadedWidths()).toEqual([100, 300]);
  });

  it('saves nothing when cancelled while the file is being joined', async () => {
    let open: () => void = () => undefined;
    mocks.joinGate = new Promise(resolve => (open = resolve));
    renderHeader();
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Descargar' }));
    expect(await within(dialog).findByText('Armando el archivo…')).toBeVisible();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await act(async () => {
      open();
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(mocks.download).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: 'Descargar' })).toBeEnabled();
  });

  it('states a stay without CT and packs separate files when the ZIP is chosen', async () => {
    mocks.search.mockResolvedValue({ rut: RUT, examenes: [xRay] });
    renderHeader();
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Archivos separados (ZIP)' }));
    // Taken out and put back, the record still comes first.
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Ficha clínica/ }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Ficha clínica/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Descargar' }));

    await waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(1));
    const [blob, name] = mocks.download.mock.calls[0] as [Blob, string];
    expect(name).toBe('PACIENTE SINTETICO - Ficha examenes e informes TAC - 2026-11-06.zip');
    expect(Object.keys(new PizZip(await readBytes(blob)).files)).toEqual([
      `1 ${HISTORY_NAME}`,
      '2 PACIENTE SINTETICO - Examenes de laboratorio - 2026-11-01 a 2026-11-06.pdf',
    ]);
    const progress = within(dialog).getByRole('list', { name: 'Avance de la descarga' });
    expect(
      within(progress)
        .getAllByRole('listitem')
        .map(item => item.textContent)
    ).toEqual([
      expect.stringMatching(/^Ficha clínica/),
      expect.stringMatching(/^Exámenes de sangre/),
      expect.stringMatching(/^Informes de TAC · MMRADSin TAC en esta hospitalización\./),
    ]);
    expect(mocks.pdf).not.toHaveBeenCalled();
  });

  it('reports a failed MMRAD search as a failure, never as a stay without CT', async () => {
    // The session already remembers an empty check-digit answer for this stay: that proves nothing.
    localStorage.setItem(SESSION_OWNER_KEY, 'owner-synthetic');
    act(() => setSessionGeneration('session-a'));
    openMMRADExamListMemory({ rut: RUT, dateFrom: '2026-11-01', dateTo: '' }).remember({
      rut: RUT,
      examenes: [],
      check_digit_search: 'partial',
    });
    mocks.search.mockRejectedValue(new Error('Servidor MMRAD no disponible.'));
    mocks.checkDigit.mockResolvedValue({ rut: RUT, examenes: [], check_digit_search: 'partial' });
    renderHeader();
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Descargar' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Falta parte de lo pedido/);
    const progress = within(dialog).getByRole('list', { name: 'Avance de la descarga' });
    expect(progress).toHaveTextContent('MMRAD no respondió: Servidor MMRAD no disponible.');
    expect(progress).not.toHaveTextContent('Sin TAC');
    expect(mocks.download).not.toHaveBeenCalled();
    localStorage.removeItem(SESSION_OWNER_KEY);
  });

  it('reads Syslab from an earlier «desde» and leaves out the parts not chosen', async () => {
    renderHeader();
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Ficha clínica/ }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Informes de TAC/ }));
    fireEvent.change(within(dialog).getByLabelText('Exámenes desde'), {
      target: { value: '2026-10-25' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Descargar' }));

    await waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(1));
    expect(mocks.lab).toHaveBeenLastCalledWith(
      expect.objectContaining({ admissionDate: '2026-10-25' })
    );
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.search).not.toHaveBeenCalled();
    expect(await downloadedWidths()).toEqual([595]);
  });

  it('stops the run on a session change: the extension is told to cancel and nothing is saved', async () => {
    let settle: (result: AuditDocumentsResult) => void = () => undefined;
    auditAnswers(new Promise(resolve => (settle = resolve)));
    mocks.auditCancel.mockImplementation(() => settle({ ok: false, cancelled: true }));
    act(() => setSessionGeneration('session-a'));
    renderHeader();
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Descargar' }));
    await waitFor(() => expect(mocks.audit).toHaveBeenCalledTimes(1));

    act(() => setSessionGeneration('session-b'));

    expect(mocks.auditCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('closes and stops when another patient is chosen, and does not reopen on return', async () => {
    auditAnswers(new Promise(() => undefined));
    const view = renderHeader();
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Descargar' }));
    await waitFor(() => expect(mocks.audit).toHaveBeenCalledTimes(1));

    view.rerender(
      <ClinicalExplorerHeader
        patient={otherPatient!}
        onRequestExams={vi.fn()}
        censusDate="2026-11-06"
        indicationDate={null}
      />
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.auditCancel).toHaveBeenCalledTimes(1);

    view.rerender(
      <ClinicalExplorerHeader
        patient={patient!}
        onRequestExams={vi.fn()}
        censusDate="2026-11-06"
        indicationDate={null}
      />
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.download).not.toHaveBeenCalled();
  });
});
