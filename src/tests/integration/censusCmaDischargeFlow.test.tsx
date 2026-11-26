import { useCallback, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { PatientRow } from '@/features/census/components/PatientRow';
import { CMASection } from '@/features/census/components/CMASection';
import {
  CensusActionsProvider,
  useCensusActionCommands,
} from '@/features/census/components/CensusActionsContext';
import { CensusMovementActionsProvider } from '@/features/census/context/CensusMovementActionsContext';
import { DailyRecordProvider } from '@/context/DailyRecordContext';
import { BEDS } from '@/constants/beds';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { applyPatches } from '@/utils/patchUtils';
import { DataFactory } from '../factories/DataFactory';
import { createMockDailyRecordContext, createMockRecord, render } from './setup';

const bedR1 = BEDS.find(bed => bed.id === 'R1')!;

const CensusRowR1 = ({ record }: { record: DailyRecord }) => {
  const { handleRowAction } = useCensusActionCommands();
  return (
    <table>
      <tbody>
        <PatientRow
          data={record.beds.R1}
          bed={bedR1}
          currentDateString={record.date}
          onAction={handleRowAction}
          bedType={bedR1.type}
        />
      </tbody>
    </table>
  );
};

/** The census day as the app keeps it: the real CMA movement writes its patch onto the record. */
const CensusWithCma = ({ initial }: { initial: DailyRecord }) => {
  const [record, setRecord] = useState(initial);
  const patchRecord = useCallback(async (patch: DailyRecordPatch) => {
    setRecord(current => applyPatches(current, patch));
  }, []);
  const value = { ...createMockDailyRecordContext(record), patchRecord };
  return (
    <DailyRecordProvider value={value}>
      <CensusMovementActionsProvider>
        <CensusActionsProvider>
          <CensusRowR1 record={record} />
          <CMASection />
        </CensusActionsProvider>
      </CensusMovementActionsProvider>
    </DailyRecordProvider>
  );
};

describe('CMA discharge from the census row', () => {
  it('moves the confirmed patient into the CMA section and frees the bed', async () => {
    const record = createMockRecord('2026-11-16');
    record.beds = {
      R1: DataFactory.createMockPatient('R1', {
        patientName: 'Paciente Sintético',
        rut: '12.345.678-5',
        pathology: 'Colelitiasis',
        // CMA is offered only on the day of admission or the next one.
        admissionDate: '2026-11-16',
      }),
    };
    render(<CensusWithCma initial={record} />);
    expect(screen.getByText('Sin registros para el día seleccionado.')).toBeVisible();

    fireEvent.click(screen.getByTitle('Acciones'));
    fireEvent.click(await screen.findByText('Egreso CMA'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('¿Registrar a Paciente Sintético como egreso');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

    await waitFor(() =>
      expect(screen.queryByDisplayValue('Paciente Sintético')).not.toBeInTheDocument()
    );
    expect(screen.getByText('Paciente Sintético')).toBeVisible();
    expect(screen.getByText('12.345.678-5')).toBeVisible();
  });
});
