import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RayenImportPreviewModal } from '@/features/rayen-import/components/RayenImportPreviewModal';
import type { CensusImportDiff } from '@/features/rayen-import';

const mocks = vi.hoisted(() => ({ useRayenFillProgress: vi.fn() }));

vi.mock('@/features/rayen-import/hooks/useRayenFillStatus', () => ({
  useRayenFillProgress: () => mocks.useRayenFillProgress(),
}));

const diff: CensusImportDiff = {
  admissions: [],
  updates: [],
  moves: [],
  discharges: [
    {
      bedId: 'H2C1',
      rut: '22.025.389-9',
      patientName: 'Paciente Egresado',
      kind: 'alta',
      status: 'Vivo',
      reason: 'administrative-discharge',
      correctedDay: '2026-07-20',
    },
  ],
  pendingAdministrativeDischarges: [],
  conflicts: [],
  unchangedCount: 0,
  previousDayEdits: [
    {
      day: '2026-07-20',
      reason: 'discharge-day-correction',
      patientNames: ['Paciente Egresado'],
      recordExists: true,
      withinEditingWindow: true,
      isSigned: false,
    },
  ],
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: 1,
    pendingAdministrativeDischarges: 0,
    conflicts: 0,
    unchanged: 0,
  },
};

const settledFill = (staffingOutcome: 'resolved' | 'declined') => ({
  running: false,
  outcome: 'complete' as const,
  attemptId: 1,
  done: 8,
  total: 8,
  errors: 0,
  lastCompletedAt: '2026-07-21T17:00:00.000Z',
  staffingOutcome,
});

describe('RayenImportPreviewModal omitted changes', () => {
  beforeEach(() => {
    mocks.useRayenFillProgress.mockReturnValue({
      ...settledFill('resolved'),
      outcome: 'idle',
      attemptId: 0,
      done: 0,
      total: 0,
      lastCompletedAt: null,
      staffingOutcome: 'idle',
    });
  });

  it('does not claim full success when staffing changes were declined', () => {
    mocks.useRayenFillProgress.mockReturnValue(settledFill('declined'));

    render(
      <RayenImportPreviewModal
        isOpen
        diff={{ ...diff, previousDayEdits: [] }}
        isBusy={false}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.queryByText('Todo está actualizado')).not.toBeInTheDocument();
    expect(screen.getByText('Sincronización completada con elementos sin aplicar')).toBeVisible();
  });

  it.each([
    ['not accepted', false, true, true],
    ['unwriteable', true, false, false],
  ])(
    'keeps skipped previous-day work visible when it is %s',
    (_, accept, recordExists, writable) => {
      const onConfirm = vi.fn();
      const historicalDiff = {
        ...diff,
        previousDayEdits: diff.previousDayEdits?.map(edit => ({
          ...edit,
          recordExists,
          withinEditingWindow: writable,
        })),
      };
      const { rerender } = render(
        <RayenImportPreviewModal
          isOpen
          diff={historicalDiff}
          isBusy={false}
          error={null}
          onConfirm={onConfirm}
          onCancel={vi.fn()}
        />
      );
      if (accept) fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar e importar' }));

      mocks.useRayenFillProgress.mockReturnValue(settledFill('resolved'));
      rerender(
        <RayenImportPreviewModal
          isOpen
          diff={historicalDiff}
          isBusy={false}
          error={null}
          onConfirm={onConfirm}
          onCancel={vi.fn()}
        />
      );

      expect(onConfirm).toHaveBeenCalledWith(accept);
      expect(screen.queryByText('Todo está actualizado')).not.toBeInTheDocument();
      expect(screen.getByText('Sincronización completada con elementos sin aplicar')).toBeVisible();
    }
  );
});
