import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ search: vi.fn(), checkDigit: vi.fn(), pdf: vi.fn() }));

vi.mock('@/services/radiology/mmradService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/radiology/mmradService')>();
  return {
    ...actual,
    searchMMRADExams: (...args: unknown[]) => mocks.search(...args),
    searchMMRADCheckDigitExams: (...args: unknown[]) => mocks.checkDigit(...args),
    fetchMMRADPdfBlobUrl: (...args: unknown[]) => mocks.pdf(...args),
  };
});
vi.mock('@/components/radiology/useDicomReviewCache', () => ({
  useDicomReviewCache: () => undefined,
}));
vi.mock('@/components/radiology/DicomViewerDialog', () => ({
  DicomViewerDialog: ({ title, link, patientId }: { title: string; link: string; patientId: string }) => (
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
  exam({ nombre_examen: 'Rx abdomen simple', fecha_examen: '29/10/2026 17:05', dicom_url: null, estado: 'Pendiente' }),
];

const renderImaging = (tab: 'all' | 'img' = 'all') =>
  render(<ClinicalExplorerImaging patient={patient!} tab={tab} onShowAll={vi.fn()} />);

describe('ClinicalExplorerImaging', () => {
  beforeEach(() => {
    mocks.search.mockReset();
    mocks.checkDigit.mockReset();
    mocks.pdf.mockReset();
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

  it('offers the report only for CT and opens the viewer for studies with images', async () => {
    renderImaging('img');
    const card = await screen.findByRole('region', { name: 'Imágenes' });
    const items = await within(card).findAllByRole('listitem');
    expect(within(items[0]!).queryByRole('button', { name: /Informe/ })).toBeNull();
    expect(within(items[1]!).queryByRole('button', { name: /Imágenes|Informe/ })).toBeNull();
    fireEvent.click(within(items[2]!).getByRole('button', { name: 'Informe' }));
    expect(items[2]).toHaveTextContent('Estudio sin hallazgos agudos.');
    fireEvent.click(within(items[0]!).getByRole('button', { name: 'Imágenes' }));
    expect(await screen.findByRole('dialog', { name: 'Visor DICOM' })).toHaveTextContent(
      `Rx tórax AP|https://mmrad.example/dicom/1|${RUT}`
    );
  });

  it('shows a failed first read as a failure with retry, never as "sin estudios"', async () => {
    mocks.search.mockRejectedValueOnce(new Error('Demasiadas solicitudes.'));
    renderImaging();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Demasiadas solicitudes.');
    expect(screen.queryByText(/Sin estudios/)).toBeNull();
    fireEvent.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(2));
    await screen.findByText('Rx tórax AP');
  });

  it('says "sin estudios" only when both searches answered, and notes an unfinished one', async () => {
    mocks.search.mockResolvedValue({ rut: RUT, examenes: [] });
    let failAlternate: (error: Error) => void = () => {};
    mocks.checkDigit.mockReturnValue(new Promise((_, reject) => { failAlternate = reject; }));
    renderImaging();
    await waitFor(() => expect(mocks.search).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(screen.queryByText(/Sin estudios/)).toBeNull();
    failAlternate(new Error('timeout'));
    expect(await screen.findByText('Sin estudios de imágenes en esta hospitalización.')).toBeVisible();
    expect(screen.getByText(/La búsqueda por dígito verificador no terminó/)).toBeVisible();
  });

  it('keeps the failure of the exact search when the alternate answer arrives later', async () => {
    mocks.search.mockRejectedValueOnce(new Error('Demasiadas solicitudes.'));
    let answerAlternate: (value: unknown) => void = () => {};
    mocks.checkDigit.mockReturnValueOnce(new Promise(resolve => { answerAlternate = resolve; }));
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
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'HHR_RAYEN_SESSION_CHANGED' } }));
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
