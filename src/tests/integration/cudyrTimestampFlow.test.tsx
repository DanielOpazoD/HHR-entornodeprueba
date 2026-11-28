/** @vitest-environment jsdom */
import '../setup';
import { describe, it, expect } from 'vitest';

import { render, createMockDailyRecordContext } from './setup';
import { DataFactory } from '@/tests/factories/DataFactory';
import { HandoffCudyrPrint } from '@/features/handoff/components/HandoffCudyrPrint';

describe('CUDYR timestamp flow', () => {
  it('prints the fixed application time and the stored CUDYR author on the handoff', () => {
    const record = DataFactory.createMockDailyRecord('2026-03-23');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente Cudyr',
      rut: '12.345.678-5',
    });
    record.cudyrUpdatedAt = '2026-03-23T10:15:00.000Z';
    record.cudyrUpdatedBy = 'Enfermera Noche';

    const { container } = render(<HandoffCudyrPrint />, {
      contextValue: createMockDailyRecordContext(record),
    });

    expect(container).toHaveTextContent('Fecha y hora de corte de aplicación: 24-03-2026, 01:00');
    expect(container).toHaveTextContent('Registro CUDYR: Enfermera Noche');
  });
});
