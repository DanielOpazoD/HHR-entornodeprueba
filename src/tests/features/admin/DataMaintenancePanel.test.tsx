import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataMaintenancePanel } from '@/features/admin/components/internal/DataMaintenancePanel';

const exportMonthRecordsWithOutcome = vi.hoisted(() => vi.fn());
const exportYearToDateRecordsWithOutcome = vi.hoisted(() => vi.fn());

vi.mock('@/services/admin/dataMaintenanceService', () => ({
  exportMonthRecordsWithOutcome,
  exportYearToDateRecordsWithOutcome,
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

describe('DataMaintenancePanel default period', () => {
  const deviceZone = process.env.TZ;
  afterEach(() => {
    vi.useRealTimers();
    if (deviceZone === undefined) delete process.env.TZ;
    else process.env.TZ = deviceZone;
  });

  // 22:30 on December 31 in Rapa Nui is already 2027 in UTC, Santiago and Auckland.
  it.each(['UTC', 'America/Santiago', 'Pacific/Easter', 'Pacific/Auckland'])(
    'opens on the hospital year and month on a device in %s',
    async zone => {
      process.env.TZ = zone;
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2027-01-01T03:30:00.000Z'));
      exportYearToDateRecordsWithOutcome.mockResolvedValue({
        status: 'failed',
        data: null,
        issues: [],
        userSafeMessage: 'Sin registros sintéticos.',
      });

      render(<DataMaintenancePanel />);
      const [year, month] = screen.getAllByRole('combobox');
      expect(year).toHaveValue('2026');
      expect(month).toHaveValue('12');
      expect(screen.getAllByRole('option', { name: /^20\d\d$/ })[0]).toHaveTextContent('2026');

      fireEvent.click(screen.getByText('Descargar año hasta la fecha'));
      await waitFor(() => expect(exportYearToDateRecordsWithOutcome).toHaveBeenCalledWith(2026));
    }
  );
});
