import { useCallback, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { BedManagerModal } from '@/features/census/components/bed-manager/BedManagerModal';
import { PatientRow } from '@/features/census/components/PatientRow';
import { DailyRecordProvider } from '@/context/DailyRecordContext';
import { BEDS } from '@/constants/beds';
import { useBedManagement } from '@/hooks/useBedManagement';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { applyPatches } from '@/utils/patchUtils';
import { DataFactory } from '../factories/DataFactory';
import { createMockDailyRecordContext, createMockRecord, render } from './setup';

vi.mock('@/hooks/useScrollLock', () => ({ useScrollLock: () => {}, default: () => {} }));

const bedR2 = BEDS.find(bed => bed.id === 'R2')!;

/** The census day as the app keeps it: the real bed actions write patches onto the record. */
const CensusWithBedManager = ({ initial }: { initial: DailyRecord }) => {
  const [record, setRecord] = useState(initial);
  const patchRecord = useCallback(async (patch: DailyRecordPatch) => {
    setRecord(current => applyPatches(current, patch));
  }, []);
  const bedActions = useBedManagement(record, patchRecord);
  const value = { ...createMockDailyRecordContext(record), ...bedActions };
  return (
    <DailyRecordProvider value={value}>
      <BedManagerModal isOpen onClose={() => {}} />
      <table>
        <tbody>
          <PatientRow
            data={record.beds.R2}
            bed={bedR2}
            currentDateString={record.date}
            onAction={() => {}}
            bedType={bedR2.type}
          />
        </tbody>
      </table>
    </DailyRecordProvider>
  );
};

describe('blocking a census bed', () => {
  it('shows the bed blocked with its reason in the manager and the census row, then frees it', () => {
    const record = createMockRecord('2026-11-16');
    record.beds = { R2: DataFactory.createMockPatient('R2', { patientName: '' }) };
    render(<CensusWithBedManager initial={record} />);

    fireEvent.click(screen.getByRole('button', { name: 'Gestionar cama R2: Disponible' }));
    fireEvent.change(screen.getByPlaceholderText('Ej: Mantención, Aislamiento…'), {
      target: { value: 'Aislamiento respiratorio' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(screen.getByRole('button', { name: 'Gestionar cama R2: Bloqueada' })).toBeVisible();
    const row = screen.getByRole('row');
    expect(within(row).getByText('Cama Bloqueada')).toBeVisible();
    expect(within(row).getByText('(Aislamiento respiratorio)')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Gestionar cama R2: Bloqueada' }));
    fireEvent.click(screen.getByRole('button', { name: 'Desbloquear Cama' }));

    expect(screen.getByRole('button', { name: 'Gestionar cama R2: Disponible' })).toBeVisible();
    expect(within(screen.getByRole('row')).queryByText('Cama Bloqueada')).not.toBeInTheDocument();
  });
});
