/** @vitest-environment jsdom */
import '../setup';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { render, createMockDailyRecordContext } from './setup';
import { DataFactory } from '@/tests/factories/DataFactory';
import { bedManagementReducer } from '@/hooks/useBedManagementReducer';
import { applyPatches } from '@/utils/patchUtils';
import { HandoffCudyrPrint } from '@/features/handoff/components/HandoffCudyrPrint';

describe('CUDYR timestamp flow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T10:15:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stamps the modification time when a score changes and prints the fixed application time on the handoff', () => {
    const record = DataFactory.createMockDailyRecord('2026-03-23');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente Cudyr',
      rut: '1-9',
    });

    const patch = bedManagementReducer(record, {
      type: 'UPDATE_CUDYR',
      bedId: 'R1',
      field: 'changeClothes',
      value: 2,
    });

    expect(patch).not.toBeNull();

    const updatedRecord = applyPatches(record, patch!);
    updatedRecord.cudyrUpdatedBy = 'Enfermera Noche';

    const { container } = render(<HandoffCudyrPrint />, {
      contextValue: createMockDailyRecordContext(updatedRecord),
    });

    expect(updatedRecord.cudyrUpdatedAt).toBe('2026-03-23T10:15:00.000Z');
    expect(container).toHaveTextContent('Fecha y hora de corte de aplicación: 24-03-2026, 1:00 AM');
    expect(container).toHaveTextContent('Registro CUDYR: Enfermera Noche');
  });
});
