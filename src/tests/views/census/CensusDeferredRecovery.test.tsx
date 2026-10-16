import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';

const fault = vi.hoisted(() => ({
  permanent: false,
  loads: vi.fn(),
  confirm: vi.fn(),
  reload: vi.fn(),
}));
// Inject a transport failure at the existing lazy-loader port, keeping its real recovery policy.
vi.mock('@/utils/lazyWithRetry', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/lazyWithRetry')>();
  return {
    lazyWithRetry: (factory: () => Promise<{ default: React.ComponentType }>) => {
      let attempts = 0;
      return actual.lazyWithRetry(async () => {
        fault.loads();
        if (attempts++ === 0 || fault.permanent)
          throw new Error('Failed to fetch dynamically imported module');
        return factory();
      });
    },
  };
});
vi.mock('@/shared/runtime/browserWindowRuntimeCore', () => ({
  defaultBrowserWindowRuntime: { confirm: fault.confirm, reload: fault.reload },
}));
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));
vi.mock('@/features/cudyr', () => ({
  CudyrMonthlyIndicator: ({ date }: { date: string }) => (
    <section aria-label="CUDYR recuperado">{date}</section>
  ),
}));
vi.mock('@/features/rayen-import/RayenImportButton', () => ({
  RayenImportButton: () => <button>Sincronización recuperada</button>,
}));
vi.mock('@/context/StaffContext', () => ({
  useStaffContext: () => ({ nursesList: [], tensList: [] }),
}));
vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: () => ({ record: { date: '2026-10-15' } }),
  useDailyRecordBeds: () => ({}),
  useDailyRecordStaff: () => ({ date: '2026-10-15' }),
  useDailyRecordMovements: () => null,
}));
vi.mock('@/context/useDailyRecordScopedActions', () => ({
  useDailyRecordStaffActions: () => ({}),
}));
vi.mock('@/features/census/components/NurseSelector', () => ({ NurseSelector: () => null }));
vi.mock('@/features/census/components/TensSelector', () => ({ TensSelector: () => null }));
const online = (value: boolean) =>
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
afterEach(() => {
  cleanup();
  online(true);
  vi.restoreAllMocks();
});

describe.each(['cudyr', 'sync'] as const)('deferred census %s recovery', panel => {
  it.each([false, true])(
    'preserves edits with a transient offline or persistent=%s chunk failure',
    async permanent => {
      vi.resetModules();
      fault.loads.mockClear();
      fault.permanent = permanent;
      online(permanent);
      const reload = fault.reload.mockReset();
      const confirm = fault.confirm.mockReset().mockReturnValue(false);
      const { CensusSummarySwitcher } =
        await import('@/features/census/components/CensusSummarySwitcher');
      const { CensusStaffHeader } = await import('@/features/census/components/CensusStaffHeader');
      render(
        <>
          <input aria-label="Edición local" defaultValue="Texto pendiente" />
          {panel === 'cudyr' ? (
            <CensusSummarySwitcher date="2026-10-15" stats={DataFactory.createMockStatistics()} />
          ) : (
            <CensusStaffHeader stats={null} />
          )}
        </>
      );
      if (panel === 'cudyr')
        fireEvent.click(screen.getByRole('button', { name: 'Mostrar cumplimiento CUDYR mensual' }));
      const draft = screen.getByRole('textbox');
      await waitFor(() => expect(fault.loads).toHaveBeenCalledTimes(1));
      if (permanent) {
        expect(await screen.findByRole('alert')).toHaveTextContent('Guarda tus cambios');
        fireEvent.click(screen.getByRole('button', { name: 'Recargar aplicación' }));
        expect(confirm).toHaveBeenCalledTimes(1);
      } else {
        expect(screen.getByRole('status')).toBeVisible();
        online(true);
        await act(async () => {
          window.dispatchEvent(new Event('online'));
        });
        if (panel === 'cudyr')
          expect(await screen.findByRole('region', { name: 'CUDYR recuperado' })).toHaveTextContent(
            '2026-10-15'
          );
        else
          expect(
            await screen.findByRole('button', { name: 'Sincronización recuperada' })
          ).toBeEnabled();
        expect(fault.loads).toHaveBeenCalledTimes(2);
      }
      expect(screen.getByRole('textbox')).toBe(draft);
      expect(draft).toHaveValue('Texto pendiente');
      expect(reload).not.toHaveBeenCalled();
    }
  );
});
