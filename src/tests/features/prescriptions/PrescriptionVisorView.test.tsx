import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PrescriptionRecord } from '@/types/prescriptionTypes';

const bedGridViewSpy = vi.fn();
const exportMonthlyPrescriptionsPdfSpy = vi.fn(async (_params: unknown) => ({
  exportedCount: 2,
  fileName: 'recetas-hospitalizados-2026-05-01-a-2026-05-08.pdf',
  optimizationFallbackCount: 0,
}));

const buildRecord = (
  id: string,
  createdAt: string,
  overrides: Partial<PrescriptionRecord> = {}
): PrescriptionRecord => ({
  id,
  hospitalId: 'hhr',
  prescriptionType: 'comun',
  image: {
    storagePath: `prescriptions/hhr/${id}/full.jpg`,
    thumbnailStoragePath: `prescriptions/hhr/${id}/thumb.jpg`,
    byteSize: 200_000,
    width: 1200,
    height: 900,
    contentType: 'image/jpeg',
  },
  uploader: { source: 'qr_pin' },
  createdAt,
  expiresAt: '2026-06-03T10:00:00.000Z',
  ...overrides,
});

const controllerRecords = [
  buildRecord('rx-1', '2026-05-01T10:00:00.000Z'),
  buildRecord('rx-2', '2026-05-08T10:00:00.000Z'),
];

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    role: 'nurse_hospital',
    isEditor: false,
    currentUser: { email: 'enf@h.cl' },
  }),
}));

vi.mock('@/features/prescriptions/hooks/usePrescriptionListController', () => ({
  usePrescriptionListController: () => ({
    phase: 'ready',
    records: controllerRecords,
    filteredRecords: controllerRecords,
    filters: { type: 'all', patient: 'all', search: '', selectedDate: '2026-05-06' },
    setFilter: vi.fn(),
    resetFilters: vi.fn(),
    prescriptionTypes: ['comun', 'psicotropicos', 'benzodiazepinas'],
    totalCount: controllerRecords.length,
  }),
}));

vi.mock('@/features/prescriptions/services/prescriptionMonthlyPdfService', () => ({
  DEFAULT_PRESCRIPTION_MONTHLY_PDF_OPTIONS: {
    prescriptionsPerPage: 2,
    colorMode: 'color',
    imageQuality: 'medium',
  },
  exportMonthlyPrescriptionsPdf: (params: unknown) => exportMonthlyPrescriptionsPdfSpy(params),
}));

vi.mock('@/features/prescriptions/components/PrescriptionDateStrip', () => ({
  PrescriptionDateStrip: () => <div data-testid="prescription-date-strip" />,
}));

vi.mock('@/features/prescriptions/components/PrescriptionBedGridView', () => ({
  PrescriptionBedGridView: (props: Record<string, unknown>) => {
    bedGridViewSpy(props);
    return <div data-testid="prescription-bed-grid-view" />;
  },
}));

vi.mock('@/features/prescriptions/components/PrescriptionListItem', () => ({
  PrescriptionListItem: () => <div data-testid="prescription-list-item" />,
}));

import { PrescriptionVisorView } from '@/features/prescriptions/components/PrescriptionVisorView';

describe('PrescriptionVisorView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('opens in bed-grid mode by default', () => {
    render(<PrescriptionVisorView />);

    expect(screen.getByRole('tab', { name: /por cama/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('prescription-bed-grid-view')).toBeInTheDocument();
  });

  it('does not render same-day search/type/patient filters', () => {
    render(<PrescriptionVisorView />);

    expect(screen.queryByPlaceholderText(/buscar por cama/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Todos los tipos')).not.toBeInTheDocument();
    expect(screen.queryByText('Todos los pacientes')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /limpiar filtros/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('prescription-date-strip')).toBeInTheDocument();
  });

  it('allows nursing to delete prescription photos from the bed-grid visor', () => {
    render(<PrescriptionVisorView />);

    expect(bedGridViewSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        onDelete: expect.any(Function),
      })
    );
  });

  it('exports the whole selected month instead of only the visible day', async () => {
    render(<PrescriptionVisorView />);

    fireEvent.click(screen.getByRole('button', { name: /grabar pdf mensual/i }));
    fireEvent.click(screen.getByRole('button', { name: /generar pdf/i }));

    await waitFor(() => expect(exportMonthlyPrescriptionsPdfSpy).toHaveBeenCalledTimes(1));
    expect(exportMonthlyPrescriptionsPdfSpy).toHaveBeenCalledWith({
      records: controllerRecords,
      selectedDateIso: '2026-05-06',
      options: {
        prescriptionsPerPage: 2,
        colorMode: 'color',
        imageQuality: 'medium',
      },
    });
  });

  it('passes compact PDF options selected by the user', async () => {
    render(<PrescriptionVisorView />);

    expect(screen.queryByLabelText(/recetas por página/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /grabar pdf mensual/i }));

    fireEvent.change(screen.getByLabelText(/recetas por página/i), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(/color del pdf/i), { target: { value: 'grayscale' } });
    expect(screen.queryByRole('option', { name: 'Actual' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Muy baja' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Reducida' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Compacta' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/calidad de imagen/i), {
      target: { value: 'compact' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generar pdf/i }));

    await waitFor(() => expect(exportMonthlyPrescriptionsPdfSpy).toHaveBeenCalledTimes(1));
    expect(exportMonthlyPrescriptionsPdfSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        options: {
          prescriptionsPerPage: 4,
          colorMode: 'grayscale',
          imageQuality: 'compact',
        },
      })
    );
  });

  it('restores the last monthly PDF configuration from local storage', async () => {
    window.localStorage.setItem(
      'hhr.prescriptions.monthlyPdfOptions',
      JSON.stringify({
        prescriptionsPerPage: 4,
        colorMode: 'grayscale',
        imageQuality: 'compact',
      })
    );
    render(<PrescriptionVisorView />);

    fireEvent.click(screen.getByRole('button', { name: /grabar pdf mensual/i }));

    expect(screen.getByLabelText(/recetas por página/i)).toHaveValue('4');
    expect(screen.getByLabelText(/color del pdf/i)).toHaveValue('grayscale');
    expect(screen.getByLabelText(/calidad de imagen/i)).toHaveValue('compact');

    fireEvent.click(screen.getByRole('button', { name: /generar pdf/i }));
    await waitFor(() => expect(exportMonthlyPrescriptionsPdfSpy).toHaveBeenCalledTimes(1));
    expect(exportMonthlyPrescriptionsPdfSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        options: {
          prescriptionsPerPage: 4,
          colorMode: 'grayscale',
          imageQuality: 'compact',
        },
      })
    );
  });

  it('persists PDF configuration changes and warns about low image quality', async () => {
    render(<PrescriptionVisorView />);

    fireEvent.click(screen.getByRole('button', { name: /grabar pdf mensual/i }));
    fireEvent.change(screen.getByLabelText(/recetas por página/i), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText(/color del pdf/i), { target: { value: 'grayscale' } });
    fireEvent.change(screen.getByLabelText(/calidad de imagen/i), { target: { value: 'low' } });

    expect(screen.getByText(/máximo ahorro/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /generar pdf/i }));

    await waitFor(() => expect(exportMonthlyPrescriptionsPdfSpy).toHaveBeenCalledTimes(1));
    expect(
      JSON.parse(window.localStorage.getItem('hhr.prescriptions.monthlyPdfOptions') ?? '{}')
    ).toEqual({
      prescriptionsPerPage: 6,
      colorMode: 'grayscale',
      imageQuality: 'low',
    });
  });

  it('shows a non-blocking warning when PDF image optimization falls back to original quality', async () => {
    exportMonthlyPrescriptionsPdfSpy.mockResolvedValueOnce({
      exportedCount: 2,
      fileName: 'recetas-hospitalizados-2026-05-01-a-2026-05-08.pdf',
      optimizationFallbackCount: 1,
    });
    render(<PrescriptionVisorView />);

    fireEvent.click(screen.getByRole('button', { name: /grabar pdf mensual/i }));
    fireEvent.click(screen.getByRole('button', { name: /generar pdf/i }));

    expect(
      await screen.findByText(/1 imagen se imprimirá en calidad original/i)
    ).toBeInTheDocument();
  });
});
