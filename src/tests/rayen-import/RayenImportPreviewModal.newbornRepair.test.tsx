import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { planRayenCensusImport, applyCensusImportDiff } from '@/features/rayen-import';
import { RayenImportPreviewModal } from '@/features/rayen-import/components/RayenImportPreviewModal';
import { getActiveDischarges } from '@/application/census/movementTombstonePolicy';
import { repairRecord } from './clinicalCribDischargeRepairs.fixtures';

describe('newborn discharge repair confirmation', () => {
  it('requires confirmation and explains which complete movement is retained', () => {
    const record = repairRecord();
    const diff = planRayenCensusImport({
      current: record,
      snapshot: {
        capturedAt: '2026-09-30T18:00:00Z',
        facilityId: 1342,
        encounters: [],
      },
    }).diff;
    const onCancel = vi.fn();
    const onConfirm = vi.fn(() =>
      applyCensusImportDiff(record, diff, {
        now: new Date('2026-09-30T19:00:00Z'),
        idFactory: () => 'unused',
        syncRunId: 'repair-sync',
        actor: 'Synthetic operator',
      })
    );
    render(
      <RayenImportPreviewModal
        isOpen
        diff={diff}
        error={null}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    expect(screen.getByText(/Corregir egresos RN duplicados/)).toBeVisible();
    expect(
      screen.getByText(/se conserva el registro con ingreso y datos clínicos completos/)
    ).toBeVisible();
    const confirm = screen.getByRole('button', { name: /Confirmar e importar/ });
    expect(confirm).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(getActiveDischarges(record.discharges)).toHaveLength(3);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(getActiveDischarges(onConfirm.mock.results[0].value.record.discharges)).toHaveLength(2);
  });
});
