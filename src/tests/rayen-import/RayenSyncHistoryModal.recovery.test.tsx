import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RayenSyncHistoryModal } from '@/features/rayen-import/components/RayenSyncHistoryModal';

it('shows actionable missing information before expandable technical metrics', () => {
  render(
    <RayenSyncHistoryModal
      isOpen
      onClose={vi.fn()}
      recovery={null}
      recoveryBusy={false}
      onRecoveryAction={vi.fn()}
      history={[
        {
          id: 'synthetic-partial',
          startedAt: '2026-09-05T20:00:00Z',
          by: 'Operador de prueba',
          status: 'partial',
          coverage: {
            total: 2,
            completed: 1,
            errors: 1,
            sourceErrors: 1,
            completedAt: '2026-09-05T20:00:30Z',
            issues: [{ bedId: 'R1', source: 'devices', reason: 'source_unavailable' }],
          },
          performance: {
            stagesMs: { clinicalReads: 100 },
            counters: { requests: 3, cacheHits: 0, patches: 0, retries: 1, timeouts: 0 },
          },
        },
      ]}
    />
  );
  const issue = screen.getByText(/Cama R1 · Dispositivos: no se pudo leer/);
  const technical = screen.getByTestId('rayen-sync-technical-report');
  expect(issue).toBeVisible();
  expect(technical).not.toHaveAttribute('open');
  expect(issue.compareDocumentPosition(technical) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Datos clínicos' })).toContainElement(issue);
  expect(screen.getByRole('region', { name: 'Enfermería y TENS' })).not.toContainElement(issue);
  fireEvent.click(screen.getByText('Reporte técnico'));
  expect(technical).toHaveAttribute('open');
  expect(screen.getByText(/3 solicitudes Eloísa/)).toBeVisible();
  expect(screen.getByText('Lecturas clínicas')).toBeVisible();
});
