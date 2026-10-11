import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { HandoffCudyrPrintTable } from '@/features/handoff/components/HandoffCudyrPrintTable';
import { buildCudyrPrintMetrics } from '@/features/handoff/components/handoffCudyrPrintSupport';

describe('HandoffCudyrPrintTable', () => {
  it('prints an imported category and exclusion together without adding the patient to the denominator', () => {
    const record = DataFactory.createMockDailyRecord('2026-04-12');
    record.beds.R2 = DataFactory.createMockPatient('R2', {
      patientName: 'Sintético excluido',
      admissionDate: '2026-04-12',
      admissionTime: '23:30',
    });
    record.beds.R2.evaluationScores = {
      cudyr: { category: 'C1', recordedDate: '2026-04-12', source: 'Eloisa' },
    };
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Sintético elegible',
      admissionDate: '2026-04-11',
      admissionTime: '18:00',
      cudyr: DataFactory.createMockCudyr({ changeClothes: 1 }),
    });
    render(
      <HandoffCudyrPrintTable
        record={record}
        visibleBeds={[
          { id: 'R1', name: 'R1' },
          { id: 'R2', name: 'R2' },
        ]}
      />
    );
    const row = screen.getByRole('row', { name: /Sintético excluido/ });
    expect(within(row).getByText('Sintético excluido (Excluido CUDYR)')).toBeInTheDocument();
    expect(within(row).getByText('C1')).toBeInTheDocument();
    expect(within(row).getByText('Registrado')).toBeInTheDocument();
    expect(buildCudyrPrintMetrics(record)).toEqual({ occupied: 1, categorized: 1, index: 100 });
  });
});
