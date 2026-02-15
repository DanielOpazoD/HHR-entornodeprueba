import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CmaSectionRow } from '@/features/census/components/CmaSectionRow';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('CmaSectionRow', () => {
  it('renders item values and emits update callbacks', () => {
    const item = DataFactory.createMockCMA({
      id: 'cma-1',
      patientName: 'Paciente Test',
      dischargeTime: '11:00',
    });
    const onUpdate = vi.fn();

    render(
      <table>
        <tbody>
          <CmaSectionRow
            item={item}
            onUpdate={onUpdate}
            onUndo={vi.fn().mockResolvedValue(undefined)}
            onDelete={vi.fn()}
          />
        </tbody>
      </table>
    );

    expect(screen.getByText('Paciente Test')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('11:00'), {
      target: { value: '12:15' },
    });
    expect(onUpdate).toHaveBeenCalledWith('cma-1', 'dischargeTime', '12:15');
  });

  it('uses fallback undo title when record has no original bed', () => {
    const item = DataFactory.createMockCMA({
      id: 'cma-2',
      originalBedId: undefined,
    });

    render(
      <table>
        <tbody>
          <CmaSectionRow
            item={item}
            onUpdate={vi.fn()}
            onUndo={vi.fn().mockResolvedValue(undefined)}
            onDelete={vi.fn()}
          />
        </tbody>
      </table>
    );

    expect(screen.getByTitle('Deshacer (sin datos originales)')).toBeInTheDocument();
  });
});
