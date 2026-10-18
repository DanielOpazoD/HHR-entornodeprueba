import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RayenSyncHistoryModal } from '@/features/rayen-import/components/RayenSyncHistoryModal';
import { rayenSyncCensusHref } from '@/features/rayen-import/components/rayenSyncIssueSupport';
import type { RayenSyncEvent } from '@/types/domain/rayenSync';

const DATE = '2026-09-27';
const event: RayenSyncEvent = {
  id: 'synthetic-run',
  sourceDate: DATE,
  startedAt: '2026-09-28T03:00:00Z',
  by: 'Operador sintético',
  status: 'partial',
  coverage: {
    total: 2,
    completed: 1,
    errors: 1,
    sourceErrors: 2,
    completedAt: '2026-09-28T03:01:00Z',
    issues: [
      { bedId: 'H5C2', source: 'vitals', reason: 'source_timeout' },
      { bedId: 'R1', source: 'cudyr', reason: 'historical_archive_failed' },
    ],
  },
};
const show = (entry: RayenSyncEvent, targetDate?: string, expand = true) => {
  const view = render(
    <RayenSyncHistoryModal
      isOpen
      onClose={vi.fn()}
      history={[entry]}
      targetDate={targetDate}
      recovery={null}
      recoveryBusy={false}
      onRecoveryAction={vi.fn()}
    />
  );
  if (expand) {
    view.baseElement.querySelectorAll('details').forEach(detail => {
      const summary = detail.querySelector('summary');
      if (summary?.textContent?.startsWith('Qué quedó pendiente')) fireEvent.click(summary);
    });
  }
  return view;
};

afterEach(() => vi.unstubAllGlobals());

describe('synchronization issue navigation and shareable code', () => {
  it('starts the yellow clinical notice collapsed and lets the user expand it', () => {
    const view = show(event, undefined, false);
    const summary = screen.getByText('Qué quedó pendiente en la información clínica');
    const panel = summary.closest('details')!;
    expect(panel.open).toBe(false);
    fireEvent.click(summary);
    expect(panel.open).toBe(true);
    view.unmount();
    const structural = show(
      {
        ...event,
        coverage: undefined,
        structuralReview: {
          structureConfirmed: true,
          isolatedConflicts: 1,
          historicalCorrectionsPending: false,
          historicalCorrectionsRequireFreshCapture: false,
          issues: [{ bedId: 'R1', reason: 'occupied-local-bed' }],
        },
      },
      undefined,
      false
    );
    expect(screen.getByTestId('rayen-structural-review-detail')).not.toHaveAttribute('open');
    structural.unmount();
  });

  it('explains a structural problem with the captured identity and a practical next step', () => {
    show({
      ...event,
      coverage: undefined,
      structuralReview: {
        structureConfirmed: true,
        isolatedConflicts: 1,
        historicalCorrectionsPending: false,
        historicalCorrectionsRequireFreshCapture: false,
        issues: [
          {
            bedId: null,
            reason: 'unverified-report-row',
            diagnostic: {
              patientName: 'Paciente Sintético',
              document: 'PAS-TEST',
              bedId: 'C-R3',
              detail: 'El informe no informa el episodio del RN.',
            },
          },
        ],
      },
    });
    expect(screen.getByText('Alta sin vinculación confirmada')).toBeVisible();
    expect(screen.getByText('Paciente Sintético · Cama C-R3')).toBeVisible();
    expect(screen.getByText('Documento: PAS-TEST')).toBeVisible();
    expect(screen.getByText(/Qué ocurrió: El informe no informa/)).toBeVisible();
    expect(screen.getByText(/Comprueba el episodio y las fechas/)).toBeVisible();
    expect(screen.getByText('Este cambio no se aplicó automáticamente.')).toBeVisible();
  });

  it('uses the event day even after midnight and copies only the technical category', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    show(event, '2026-09-28');
    expect(screen.getByRole('link', { name: /Ver cama H5C2/ })).toHaveAttribute(
      'href',
      '/census?date=2026-09-27&focusBed=H5C2'
    );
    // The historical bed may differ from today's after a transfer. Link only the known day.
    expect(screen.getByRole('link', { name: 'Ver censo · 26-09-2026' })).toHaveAttribute(
      'href',
      '/census?date=2026-09-26'
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Copiar código HHR-SYNC-1/vitals/source_timeout' })
    );
    await waitFor(() => expect(screen.getByText('Código copiado')).toBeVisible());
    expect(writeText).toHaveBeenCalledExactlyOnceWith('HHR-SYNC-1/vitals/source_timeout');
  });

  it('supports the owning day for legacy events without inventing unknown destinations', () => {
    const legacy = {
      ...event,
      sourceDate: undefined,
      coverage: {
        ...event.coverage!,
        issues: [
          { bedId: '*', source: 'cudyr' as const, reason: 'source_unavailable' as const },
          { bedId: 'UNKNOWN', source: 'vitals' as const, reason: 'unexpected' as const },
          {
            bedId: 'R1',
            source: 'census' as const,
            reason: 'historical_census_write_failed' as const,
          },
        ],
      },
    };
    const view = show(legacy, DATE);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/census?date=2026-09-27');
    view.unmount();
    show(legacy);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('HHR-SYNC-1/vitals/unexpected')).toBeVisible();
    expect(rayenSyncCensusHref('2026-02-30', 'R1')).toBeNull();
    expect(rayenSyncCensusHref('20260927', 'R1')).toBeNull();
    expect(rayenSyncCensusHref(DATE, 'R1&date=2026-01-01')).toBeNull();
  });

  it('links current structural issues but leaves historical evidence without an inferred row', () => {
    show({
      ...event,
      coverage: undefined,
      structuralReview: {
        historicalCorrectionsPending: true,
        historicalCorrectionsRequireFreshCapture: false,
        isolatedConflicts: 2,
        issues: [
          { bedId: 'R4', reason: 'occupied-local-bed' },
          { bedId: 'R2', reason: 'historical-reconstruction' },
        ],
      },
    });
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/census?date=2026-09-27&focusBed=R4');
    expect(screen.getByText('HHR-SYNC-1/census/historical-reconstruction')).toBeVisible();
  });

  it('identifies the prior census patient and links the original bed without copying clinical context', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    show({
      ...event,
      coverage: undefined,
      structuralReview: {
        historicalCorrectionsPending: false,
        historicalCorrectionsRequireFreshCapture: false,
        isolatedConflicts: 1,
        issues: [
          {
            bedId: null,
            reason: 'previous-census-continuity',
            caseContext: {
              patientName: 'Paciente Sintético',
              censusDate: '2026-09-26',
              bedId: 'H6C2',
            },
          },
        ],
      },
    });
    expect(screen.getByText('Paciente Sintético · Cama H6C2')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Ver cama H6C2 · 26-09-2026' })).toHaveAttribute(
      'href',
      '/census?date=2026-09-26&focusBed=H6C2'
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Copiar código HHR-SYNC-1/census/previous-census-continuity',
      })
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledExactlyOnceWith(
        'HHR-SYNC-1/census/previous-census-continuity'
      )
    );
  });

  it('keeps a selectable code when clipboard access fails and supports run-level failures', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    show({
      ...event,
      coverage: undefined,
      status: 'failed',
      failureReason: 'extension_incompatible',
    });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Copiar código HHR-SYNC-1/run/extension_incompatible' })
    );
    await waitFor(() =>
      expect(screen.getByText('Selecciona el código para copiarlo.')).toBeVisible()
    );
    expect(screen.getByText('HHR-SYNC-1/run/extension_incompatible').tagName).toBe('CODE');
  });
});
