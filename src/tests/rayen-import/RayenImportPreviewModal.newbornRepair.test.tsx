import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { planRayenCensusImport, applyCensusImportDiff } from '@/features/rayen-import';
import { RayenImportPreviewModal } from '@/features/rayen-import/components/RayenImportPreviewModal';
import { getActiveDischarges } from '@/application/census/movementTombstonePolicy';
import { DischargeDataSchema } from '@/schemas/zod/movements';
import { repairRecord } from './clinicalCribDischargeRepairs.fixtures';

describe('newborn discharge repair confirmation', () => {
  it.each(['11:21', '11:20'])(
    'requires confirmation and explains the retained movement (copy time %s)',
    time => {
      const record = repairRecord();
      record.discharges[1].time = time;
      record.discharges = record.discharges.map(row => DischargeDataSchema.parse(row));
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
      if (time !== record.discharges[0].time) {
        expect(screen.getByText(/La copia del informe figura a las 11:20/)).toBeVisible();
        expect(screen.getByText(/se conserva la hora del registro completo/)).toBeVisible();
      } else {
        expect(screen.queryByText(/La copia del informe figura/)).not.toBeInTheDocument();
      }
      const confirm = screen.getByRole('button', { name: /Confirmar e importar/ });
      expect(confirm).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
      expect(onCancel).toHaveBeenCalledOnce();
      expect(onConfirm).not.toHaveBeenCalled();
      expect(getActiveDischarges(record.discharges)).toHaveLength(3);
      fireEvent.click(confirm);
      expect(onConfirm).toHaveBeenCalledOnce();
      expect(getActiveDischarges(onConfirm.mock.results[0].value.record.discharges)).toHaveLength(
        2
      );
    }
  );
});
