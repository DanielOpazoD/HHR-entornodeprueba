import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RayenImportButton } from '@/features/rayen-import/components/RayenImportButton';

const state = vi.hoisted(() => ({ open: false, imports: 0, confirm: vi.fn() }));
vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: () => ({ record: { date: '2026-11-11' } }),
}));
vi.mock('@/features/rayen-import/hooks/useRayenImport', () => ({
  useRayenImport: () => ({
    policyStatus: 'ready',
    execution: null,
    diff: null,
    isPreviewOpen: state.open,
    result: null,
    error: null,
    staffingProposal: null,
    confirm: state.confirm,
  }),
}));
vi.mock('@/features/rayen-import/hooks/useRayenFillStatus', () => ({
  useRayenFillProgress: () => ({ running: false, done: 0, total: 0, errors: 0 }),
}));
vi.mock('@/features/rayen-import/hooks/useRayenExtensionHealth', () => ({
  useRayenExtensionHealth: () => ({ connection: 'ready', canSync: true, refresh: vi.fn() }),
}));
vi.mock('@/hooks/useSyncQueueMonitor', () => ({
  useSyncQueueMonitor: () => ({ stats: {}, operations: [], refresh: vi.fn() }),
}));
vi.mock('@/features/rayen-import/components/RayenConnectionMonitor', () => ({
  RayenConnectionMonitor: () => null,
}));
vi.mock('@/features/rayen-import/components/RayenImportPreviewModal', () => ({
  get RayenImportPreviewModal() {
    state.imports += 1;
    throw new TypeError('Failed to fetch dynamically imported module');
  },
}));

it('loads review only when opened and offers explicit recovery without confirming changes', async () => {
  const confirmReload = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const view = render(<RayenImportButton />);
  expect(state.imports).toBe(0);
  state.open = true;
  view.rerender(<RayenImportButton />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar esta sección');
  fireEvent.click(screen.getByRole('button', { name: 'Recargar aplicación' }));
  expect(confirmReload).toHaveBeenCalledWith(
    'Recargar la aplicación puede descartar cambios sin guardar. ¿Quieres continuar?'
  );
  expect(state.confirm).not.toHaveBeenCalled();
  expect(screen.getByTestId('rayen-import-button')).toBeVisible();
  confirmReload.mockRestore();
});
