import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  checkDigit: vi.fn(),
  pdf: vi.fn(),
  blob: vi.fn(),
  download: vi.fn(),
}));

vi.mock('@/services/radiology/mmradService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/radiology/mmradService')>();
  return {
    ...actual,
    searchMMRADExams: (...args: unknown[]) => mocks.search(...args),
    searchMMRADCheckDigitExams: (...args: unknown[]) => mocks.checkDigit(...args),
    fetchMMRADPdfBlobUrl: (...args: unknown[]) => mocks.pdf(...args),
    fetchMMRADPdfBlob: (...args: unknown[]) => mocks.blob(...args),
  };
});
vi.mock('@/services/exporters/exportDownload', () => ({
  downloadBlob: (...args: unknown[]) => mocks.download(...args),
}));
vi.mock('@/components/radiology/useDicomReviewCache', () => ({
  useDicomReviewCache: () => undefined,
}));
vi.mock('@/components/radiology/DicomViewerDialog', () => ({
  DicomViewerDialog: ({
    title,
    link,
    patientId,
  }: {
    title: string;
    link: string;
    patientId: string;
  }) => (
    <div role="dialog" aria-label="Visor DICOM">
      {`${title}|${link}|${patientId}`}
    </div>
  ),
}));

import { BEDS } from '@/constants/beds';
import { ClinicalExplorerImaging } from '@/features/census/components/clinical-explorer/ClinicalExplorerImaging';
import { listClinicalExplorerPatients } from '@/features/census/controllers/clinicalExplorerController';
import type { MMRADExam } from '@/services/radiology/mmradService';
import { DataFactory } from '@/tests/factories/DataFactory';

const RUT = '12.345.678-5';
const [patient] = listClinicalExplorerPatients({
  visibleBeds: BEDS.filter(bed => !bed.isExtra),
  beds: {
    H3C1: DataFactory.createMockPatient('H3C1', {
      patientName: 'PACIENTE SINTÉTICO',
      rut: RUT,
      clinicalEpisodeId: 'ep-1',
      admissionDate: '2026-10-28',
    }),
  },
});

const exam = (overrides: Partial<MMRADExam>): MMRADExam => ({
  nombre_examen: 'Rx tórax AP',
  fecha_examen: '02/11/2026 09:40',
  fecha_asignacion: '02/11/2026',
  mod: 'CR',
  estado: 'Validado',
  pdf_url: null,
  dicom_url: 'https://mmrad.example/dicom/1',
  informe_html_url: null,
  report: null,
  ...overrides,
});
const studies = [
  exam({}),
  exam({
    nombre_examen: 'TC tórax sin contraste',
    fecha_examen: '24/10/2026 11:30',
    mod: 'CT',
    dicom_url: 'https://mmrad.example/dicom/3',
    pdf_url: 'https://mmrad.example/pdf/3',
    report: {
      title: 'TC de tórax',
      technique: 'Sin contraste.',
      antecedentesClinicos: null,
      findings: 'Sin condensaciones.',
      impression: 'Estudio sin hallazgos agudos.',
    },
  }),
  exam({
    nombre_examen: 'Rx abdomen simple',
    fecha_examen: '29/10/2026 17:05',
    dicom_url: null,
    estado: 'Pendiente',
  }),
];

const renderImaging = (tab: 'all' | 'img' = 'all') =>
  render(<ClinicalExplorerImaging patient={patient!} tab={tab} onShowAll={vi.fn()} />);

describe('ClinicalExplorerImaging', () => {
  afterEach(() => {
    act(() => setSessionGeneration(null));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    mocks.search.mockReset();
    mocks.checkDigit.mockReset();
    mocks.pdf.mockReset();
    mocks.blob.mockReset();
    mocks.download.mockReset();
    mocks.search.mockResolvedValue({ rut: RUT, examenes: studies });
    mocks.checkDigit.mockResolvedValue({ rut: RUT, examenes: [] });
  });

  it('lists the studies newest first without status or modality labels, from the admission on', async () => {
    renderImaging();
    const card = await screen.findByRole('region', { name: 'Imágenes' });
    const items = await within(card).findAllByRole('listitem');
    expect(items.map(item => item.textContent)).toEqual([
      expect.stringContaining('Rx tórax AP'),
      expect.stringContaining('Rx abdomen simple'),
      expect.stringContaining('TC tórax sin contraste'),
    ]);
    expect(items[0]).toHaveTextContent('02-11-2026 09:40');
    expect(card).not.toHaveTextContent(/Validado|Pendiente/);
    expect(within(items[0]!).queryByText('CR')).toBeNull();
    expect(mocks.search).toHaveBeenCalledWith({ rut: RUT, dateFrom: '2026-10-28' });
    expect(mocks.checkDigit).toHaveBeenCalledWith({
      rut: RUT,
      dateFrom: '2026-10-28',
      patientName: 'PACIENTE SINTÉTICO',
    });
  });

  const preparePdf = () => {
    mocks.search.mockResolvedValue({
      rut: RUT,
      examenes: [exam({ mod: 'CT', pdf_url: 'https://mmrad.example/pdf/synthetic' })],
    });
    const popup = { location: { href: '' }, focus: vi.fn(), close: vi.fn(), closed: false };
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const createUrl = vi.fn(() => 'blob:synthetic-report');
    const revokeUrl = vi.fn();
    const OriginalURL = URL;
    vi.stubGlobal(
      'URL',
      class extends OriginalURL {
        static createObjectURL = createUrl;
        static revokeObjectURL = revokeUrl;
      }
    );
    return { popup, createUrl, revokeUrl };
  };

  it.each(['', 'Sin fecha'])(
    'shows the actual full period when admission is %s',
    async admissionDate => {
      mocks.search.mockResolvedValue({ rut: RUT, examenes: [] });
      render(
        <ClinicalExplorerImaging
          patient={{ ...patient!, data: { ...patient!.data, admissionDate } }}
          tab="all"
          onShowAll={vi.fn()}
        />
      );
      await screen.findByText('Sin estudios de imágenes en MMRAD para este paciente.');
      expect(
        screen.getByText(/Período: todo el historial disponible en MMRAD, hasta hoy/)
      ).toBeVisible();
      expect(
        screen.queryByRole('checkbox', { name: 'Incluir exámenes anteriores al ingreso' })
      ).toBeNull();
    }
  );

  it.each(['patient', 'episode', 'session'])(
    'reveals earlier studies and scopes the period to the current %s',
    async change => {
      mocks.search.mockImplementation(async ({ dateFrom }: { dateFrom?: string }) => ({
        rut: RUT,
        examenes: dateFrom ? [] : [studies[1]],
      }));
      const view = renderImaging();
      await screen.findByText(
        'Sin estudios de imágenes desde el ingreso. Puede haber exámenes anteriores.'
      );
      fireEvent.click(
        screen.getByRole('checkbox', { name: 'Incluir exámenes anteriores al ingreso' })
      );
      await screen.findByText('TC tórax sin contraste');
      expect(mocks.search).toHaveBeenLastCalledWith({
        rut: RUT,
        dateFrom: undefined,
        dateTo: undefined,
      });
      expect(
        screen.getByText(/Período: todo el historial disponible en MMRAD, hasta hoy/)
      ).toBeVisible();
      if (change === 'session') act(() => setSessionGeneration('another-synthetic-session'));
      else
        view.rerender(
          <ClinicalExplorerImaging
            patient={
              change === 'episode'
                ? { ...patient!, episodeId: 'another-synthetic-episode' }
                : {
                    ...patient!,
                    data: { ...patient!.data, rut: '11.111.111-1', patientName: 'OTRO SINTÉTICO' },
                  }
            }
            tab="all"
            onShowAll={vi.fn()}
          />
        );
      expect(
        screen.getByRole('checkbox', { name: 'Incluir exámenes anteriores al ingreso' })
      ).not.toBeChecked();
      await screen.findByText(
        'Sin estudios de imágenes desde el ingreso. Puede haber exámenes anteriores.'
      );
    }
  );

  it.each(['patient', 'episode', 'session', 'unmount'])(
    'cancels a pending PDF and closes its empty window on %s change',
    async change => {
      const { popup, createUrl } = preparePdf();
      let answer: (blob: Blob) => void = () => {};
      mocks.blob.mockReturnValueOnce(
        new Promise<Blob>(resolve => {
          answer = resolve;
        })
      );
      const view = renderImaging('img');
      fireEvent.click(await screen.findByRole('button', { name: 'Informe (PDF)' }));
      const signal = mocks.blob.mock.calls[0]![1] as AbortSignal;
      if (change === 'session') act(() => setSessionGeneration('synthetic-next-pdf-session'));
      else if (change === 'unmount') view.unmount();
      else
        view.rerender(
          <ClinicalExplorerImaging
            patient={
              change === 'episode'
                ? { ...patient!, episodeId: 'ep-next' }
                : {
                    ...patient!,
                    data: { ...patient!.data, rut: '11.111.111-1', patientName: 'OTRO SINTÉTICO' },
                  }
            }
            tab="img"
            onShowAll={vi.fn()}
          />
        );
      expect(signal.aborted).toBe(true);
      expect(popup.close).toHaveBeenCalledTimes(1);
      await act(async () => answer(new Blob(['synthetic'], { type: 'application/pdf' })));
      expect(createUrl).not.toHaveBeenCalled();
      expect(popup.location.href).toBe('');
      expect(popup.focus).not.toHaveBeenCalled();
    }
  );

  it('delivers the PDF to the requested window and releases the button', async () => {
    const { popup, createUrl } = preparePdf();
    mocks.blob.mockResolvedValueOnce(new Blob(['synthetic'], { type: 'application/pdf' }));
    renderImaging('img');
    const button = await screen.findByRole('button', { name: 'Informe (PDF)' });
    fireEvent.click(button);
    await waitFor(() => expect(popup.location.href).toBe('blob:synthetic-report'));
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(popup.focus).toHaveBeenCalledTimes(1);
    expect(button).toBeEnabled();
    expect(popup.close).not.toHaveBeenCalled();
  });

  it('closes the empty PDF window on failure and allows another attempt', async () => {
    const { popup } = preparePdf();
    mocks.blob.mockRejectedValueOnce(new Error('No se pudo leer el PDF.'));
    renderImaging('img');
    const button = await screen.findByRole('button', { name: 'Informe (PDF)' });
    fireEvent.click(button);
    expect(await screen.findByText('No se pudo leer el PDF.')).toBeVisible();
    expect(popup.close).toHaveBeenCalledTimes(1);
    expect(button).toBeEnabled();
  });

  it('offers the report only for CT and opens the viewer for studies with images', async () => {
    renderImaging('img');
    const card = await screen.findByRole('region', { name: 'Imágenes' });
    const items = await within(card).findAllByRole('listitem');
    expect(within(items[0]!).queryByRole('button', { name: /Informe/ })).toBeNull();
    expect(within(items[1]!).queryByRole('button', { name: /Imágenes|Informe/ })).toBeNull();
    expect(within(items[2]!).queryByRole('button', { name: 'Descargar PDF original' })).toBeNull();
    expect(
      within(items[2]!).queryByRole('button', { name: 'Copiar hallazgos e impresión' })
    ).toBeNull();
    fireEvent.click(within(items[2]!).getByRole('button', { name: 'Informe' }));
    expect(items[2]).toHaveTextContent('Estudio sin hallazgos agudos.');
    expect(within(items[2]!).getByRole('button', { name: 'Descargar PDF original' })).toBeVisible();
    expect(
      within(items[2]!).getByRole('button', { name: 'Copiar hallazgos e impresión' })
    ).toBeVisible();
    fireEvent.click(within(items[0]!).getByRole('button', { name: 'Imágenes' }));
    expect(await screen.findByRole('dialog', { name: 'Visor DICOM' })).toHaveTextContent(
      `Rx tórax AP|https://mmrad.example/dicom/1|${RUT}`
    );
  });

  it('keeps registration discrepancies behind an accessible hover, focus and click notice', async () => {
    mocks.checkDigit.mockResolvedValue({
      rut: RUT,
      examenes: [
        exam({
          nombre_examen: 'Rx rodilla sintética',
          dicom_url: 'https://mmrad.example/dicom/alternate',
          registered_patient_id: '12.345.678-9',
          registered_patient_name: 'PACIENTE SINTÉTICO',
        }),
      ],
    });
    renderImaging();
    const notice = await screen.findByRole('button', {
      name: 'Advertencia de identificación del estudio',
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.mouseEnter(notice);
    expect(screen.getByRole('tooltip')).toHaveTextContent('12.345.678-9');
    expect(screen.getByRole('tooltip')).toHaveTextContent('confirma que es el mismo paciente');
    expect(notice).toHaveAccessibleDescription(/PACIENTE SINTÉTICO/);
    fireEvent.mouseLeave(notice.parentElement!);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.focus(notice);
    expect(screen.getByRole('tooltip')).toBeVisible();
    fireEvent.keyDown(notice, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(notice);
    expect(screen.getByRole('tooltip')).toBeVisible();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.focus(notice);
    fireEvent.blur(notice);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it.each(['patient', 'episode'])(
    'never delivers a pending download after changing the %s',
    async change => {
      let resolvePdf: (blob: Blob) => void = () => {};
      mocks.blob.mockReturnValueOnce(
        new Promise<Blob>(resolve => {
          resolvePdf = resolve;
        })
      );
      const view = renderImaging('img');
      fireEvent.click(await screen.findByRole('button', { name: 'Informe' }));
      fireEvent.click(screen.getByRole('button', { name: 'Descargar PDF original' }));
      const nextPatient =
        change === 'episode'
          ? { ...patient!, episodeId: 'ep-2' }
          : {
              ...patient!,
              data: {
                ...patient!.data,
                rut: '11.111.111-1',
                patientName: 'OTRO PACIENTE SINTÉTICO',
              },
            };
      view.rerender(
        <ClinicalExplorerImaging patient={nextPatient} tab="img" onShowAll={vi.fn()} />
      );
      expect(mocks.blob.mock.calls[0]![1].aborted).toBe(true);
      await act(async () => resolvePdf(new Blob(['original'], { type: 'application/pdf' })));
      expect(mocks.download).not.toHaveBeenCalled();
      expect(screen.queryByRole('alert')).toBeNull();
    }
  );

  it('stops delivery synchronously when the session changes before the deferred PDF settles', async () => {
    let resolvePdf: (blob: Blob) => void = () => {};
    mocks.blob.mockReturnValueOnce(
      new Promise<Blob>(resolve => {
        resolvePdf = resolve;
      })
    );
    renderImaging('img');
    fireEvent.click(await screen.findByRole('button', { name: 'Informe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Descargar PDF original' }));
    await act(async () => {
      setSessionGeneration('synthetic-replacement');
      expect(mocks.blob.mock.calls[0]![1].aborted).toBe(true);
      resolvePdf(new Blob(['original'], { type: 'application/pdf' }));
      await Promise.resolve();
      expect(mocks.download).not.toHaveBeenCalled();
    });
    expect(mocks.download).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a failed first read as a failure with retry, never as "sin estudios"', async () => {
    mocks.search.mockRejectedValueOnce(new Error('Demasiadas solicitudes.'));
    renderImaging();
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('No se pudo consultar imágenes.')).toBeVisible();
    expect(alert).toHaveTextContent('Demasiadas solicitudes.');
    fireEvent.click(within(alert).getByText('Detalle de la consulta'));
    expect(within(alert).getByText('Demasiadas solicitudes.')).toBeVisible();
    expect(screen.queryByText(/Sin estudios/)).toBeNull();
    fireEvent.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(2));
    await screen.findByText('Rx tórax AP');
  });

  it('says "sin estudios" only when both searches answered, and notes an unfinished one', async () => {
    mocks.search.mockResolvedValue({ rut: RUT, examenes: [] });
    let failAlternate: (error: Error) => void = () => {};
    mocks.checkDigit.mockReturnValue(
      new Promise((_, reject) => {
        failAlternate = reject;
      })
    );
    renderImaging();
    await waitFor(() => expect(mocks.search).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(screen.queryByText(/Sin estudios/)).toBeNull();
    failAlternate(new Error('timeout'));
    expect(
      await screen.findByText(
        'Sin estudios de imágenes desde el ingreso. Puede haber exámenes anteriores.'
      )
    ).toBeVisible();
    expect(screen.getByText(/La búsqueda por dígito verificador no terminó/)).toBeVisible();
  });

  it('keeps the failure of the exact search when the alternate answer arrives later', async () => {
    mocks.search.mockRejectedValueOnce(new Error('Demasiadas solicitudes.'));
    let answerAlternate: (value: unknown) => void = () => {};
    mocks.checkDigit.mockReturnValueOnce(
      new Promise(resolve => {
        answerAlternate = resolve;
      })
    );
    renderImaging();
    await screen.findByRole('alert');
    answerAlternate({ rut: RUT, examenes: [] });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(screen.getByRole('alert')).toHaveTextContent('Demasiadas solicitudes.');
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeVisible();
  });

  it('forgets what it showed when the Eloísa session changes, even while mounted', async () => {
    renderImaging();
    await screen.findByText('Rx tórax AP');
    act(() => setSessionGeneration(`synthetic-${Date.now()}`));
    await waitFor(() => expect(screen.queryByText('Rx tórax AP')).toBeNull());
    await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(2));
  });

  it('keeps the list and says why when an unfinished check-digit search may hide a study', async () => {
    mocks.checkDigit.mockRejectedValue(new Error('timeout'));
    renderImaging();
    const card = await screen.findByRole('region', { name: 'Imágenes' });
    await within(card).findByText('Rx tórax AP');
    await within(card).findByText(/La búsqueda por dígito verificador no terminó/);
  });
});
