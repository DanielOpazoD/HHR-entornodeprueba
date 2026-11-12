import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RayenSyncHistoryModal } from '@/features/rayen-import/components/RayenSyncHistoryModal';

const state = vi.hoisted(() => ({ imports: 0 }));
vi.mock('@/features/rayen-import/components/RayenSyncTechnicalMetricsPanel', () => ({
  get RayenSyncTechnicalMetricsPanel() {
    state.imports += 1;
    throw new TypeError('Failed to fetch dynamically imported module');
  },
}));

it('loads metrics on expansion and offers explicit recovery while preserving the history', async () => {
  const confirmReload = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(
    <RayenSyncHistoryModal
      isOpen
      onClose={vi.fn()}
      recovery={null}
      recoveryBusy={false}
      onRecoveryAction={vi.fn()}
      history={[
        {
          id: 'synthetic',
          by: 'Operador de prueba',
          status: 'complete',
          startedAt: '2026-11-12T10:00:00Z',
          performance: {
            stagesMs: {},
            counters: { requests: 1, cacheHits: 0, patches: 0, retries: 0, timeouts: 0 },
          },
        },
      ]}
    />
  );
  expect(state.imports).toBe(0);
  fireEvent.click(screen.getByText('Reporte técnico'));
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar esta sección');
  expect(state.imports).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'Recargar aplicación' }));
  expect(confirmReload).toHaveBeenCalledWith(
    'Recargar la aplicación puede descartar cambios sin guardar. ¿Quieres continuar?'
  );
  expect(screen.getByText('Operador de prueba')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Copiar informe de sincronización' })).toBeVisible();
  confirmReload.mockRestore();
});
