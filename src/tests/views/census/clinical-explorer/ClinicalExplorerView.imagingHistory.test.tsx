import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn(), mmradSearch: vi.fn() }));

vi.mock('@/features/rayen-import/clinical-panel', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/rayen-import/clinical-panel')>();
  return { ...actual, requestClinicalPanel: (...args: unknown[]) => mocks.request(...args) };
});
vi.mock('@/components/modals/ImagingRequestDialog', () => ({
  ImagingRequestDialog: () => <div role="dialog" aria-label="Orden de imágenes" />,
}));
vi.mock('@/features/clinical-documents', () => ({
  ClinicalDocumentsModal: () => <div role="dialog" aria-label="Documentos clínicos" />,
}));
vi.mock('@/services/radiology/mmradService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/radiology/mmradService')>();
  return {
    ...actual,
    searchMMRADExams: (...args: unknown[]) => mocks.mmradSearch(...args),
    searchMMRADCheckDigitExams: ({ rut }: { rut: string }) =>
      Promise.resolve({ rut, examenes: [] }),
  };
});
vi.mock('@/components/radiology/useDicomReviewCache', () => ({
  useDicomReviewCache: () => undefined,
}));
vi.mock('@/features/laboratory/hooks/useSyslabAccess', () => ({
  useSyslabAccess: () => ({
    state: 'unavailable',
    message: 'Syslab no está disponible.',
    isOpening: false,
    isAwaitingLogin: false,
    refresh: vi.fn(),
    openLogin: vi.fn(),
  }),
}));

import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { panelResult } from '../clinicalPanelDrawer.fixture';
import { BEDS } from '@/constants/beds';
import { ClinicalExplorerView } from '@/features/census/components/clinical-explorer/ClinicalExplorerView';
import {
  closeClinicalExplorer,
  openClinicalExplorer,
} from '@/features/census/components/clinical-explorer/clinicalExplorerStore';
import { listClinicalExplorerPatients } from '@/features/census/controllers/clinicalExplorerController';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';

const DATE = '2026-11-04';
const patients = listClinicalExplorerPatients({
  visibleBeds: BEDS.filter(bed => !bed.isExtra),
  beds: {
    R1: DataFactory.createMockPatient('R1', {
      patientName: 'PRIMERA SINTÉTICA',
      rut: '12.345.678-5',
      clinicalEpisodeId: 'ep-r1',
      admissionDate: '2026-11-01',
    }),
  },
});

const study = (day: number) => ({
  nombre_examen: `Rx sintética ${day}`,
  fecha_examen: `${String(day).padStart(2, '0')}/10/2026 09:00`,
  fecha_asignacion: `${String(day).padStart(2, '0')}/10/2026`,
  mod: 'CR',
  estado: 'Validado',
  pdf_url: null,
  dicom_url: null,
  informe_html_url: null,
  report: null,
});

describe('ClinicalExplorerView imaging history', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-14T04:30:00Z'));
    mocks.request.mockReset();
    mocks.request.mockResolvedValue(panelResult);
    mocks.mmradSearch.mockReset();
  });
  afterEach(() => {
    act(() => {
      closeClinicalExplorer();
      setSessionGeneration(null);
    });
    vi.useRealTimers();
  });

  it('keeps earlier imaging studies when opening every study from the combined view', async () => {
    mocks.mmradSearch.mockImplementation(({ rut, dateFrom }: { rut: string; dateFrom?: string }) =>
      Promise.resolve({ rut, examenes: dateFrom ? [] : [1, 2, 3, 4, 5].map(study) })
    );
    act(() => openClinicalExplorer({ censusDate: DATE, bedId: 'R1' }));
    const { wrapper } = createQueryClientTestWrapper();
    render(<ClinicalExplorerView censusDate={DATE} bedId="R1" patients={patients} />, { wrapper });
    const history = { name: 'Incluir exámenes anteriores al ingreso' };
    fireEvent.click(await screen.findByRole('checkbox', history));
    fireEvent.click(await screen.findByRole('button', { name: /Ver los 5 estudios/ }));

    expect(screen.getByRole('tab', { name: 'Imágenes' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('checkbox', history)).toBeChecked();
    expect(screen.getByText(/Período: todo el historial disponible en MMRAD/)).toBeVisible();
    expect(await screen.findByText('Rx sintética 1')).toBeVisible();
    expect(screen.getByText('Rx sintética 5')).toBeVisible();
    expect(mocks.mmradSearch).toHaveBeenLastCalledWith(
      expect.objectContaining({ dateFrom: undefined })
    );
  });
});
