import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataMaintenancePanel } from '@/features/admin/components/internal/DataMaintenancePanel';

const exportMonthRecordsWithOutcome = vi.hoisted(() => vi.fn());

vi.mock('@/services/admin/dataMaintenanceService', () => ({
  exportMonthRecordsWithOutcome,
  exportYearToDateRecordsWithOutcome: vi.fn(),
}));
vi.mock('@/services/admin/admissionDateBackfillService', () => ({
  auditAdmissionDateBackfill: vi.fn(),
  applyAdmissionDateBackfill: vi.fn(),
}));
vi.mock('@/features/admin/components/internal/DataImportModal', () => ({
  DataImportModal: () => null,
}));

const PARTIAL_MESSAGE =
  'El respaldo se generó sin los datos clínicos por episodio de 1 día (2026-10-02). Vuelve a exportarlo con conexión al servidor.';

describe('DataMaintenancePanel export feedback', () => {
  beforeEach(() => {
    exportMonthRecordsWithOutcome.mockReset();
  });

  it('shows a downloaded but partial backup as a warning, not as an error', async () => {
    exportMonthRecordsWithOutcome.mockResolvedValue({
      status: 'partial',
      data: {
        status: 'partial',
        reason: 'clinical_derived_incomplete',
        userSafeMessage: PARTIAL_MESSAGE,
        recordCount: 3,
      },
      issues: [],
      userSafeMessage: PARTIAL_MESSAGE,
    });

    render(<DataMaintenancePanel />);
    fireEvent.click(screen.getByText('Descargar mes en JSON'));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(PARTIAL_MESSAGE));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Respaldo generado correctamente')).not.toBeInTheDocument();
  });

  it('keeps a failed export in the error banner', async () => {
    exportMonthRecordsWithOutcome.mockResolvedValue({
      status: 'failed',
      data: null,
      issues: [],
      userSafeMessage: 'No hay registros para exportar en este período.',
    });

    render(<DataMaintenancePanel />);
    fireEvent.click(screen.getByText('Descargar mes en JSON'));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'No hay registros para exportar en este período.'
      )
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
