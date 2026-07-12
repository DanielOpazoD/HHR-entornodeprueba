import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { StatusSelect } from '@/features/census/components/patient-row/StatusSelect';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { EventTextHandler } from '@/features/census/components/patient-row/inputCellTypes';
import { PatientStatus } from '@/types/domain/patientClassification';

const noop: EventTextHandler = () => () => {};

const renderStatus = (props?: Partial<React.ComponentProps<typeof StatusSelect>>) =>
  render(
    <table>
      <tbody>
        <tr>
          <StatusSelect
            data={DataFactory.createMockPatient('R1', {
              patientName: 'Juana',
              status: PatientStatus.ESTABLE,
            })}
            onChange={noop}
            {...props}
          />
        </tr>
      </tbody>
    </table>
  );

describe('StatusSelect (colored dot + popover)', () => {
  it('shows a dot labelled by the current status and opens a popover on click', () => {
    renderStatus();
    const dot = screen.getByRole('button', { name: 'Estado: Estable' });
    expect(dot).toBeInTheDocument();

    fireEvent.click(dot);
    const dialog = screen.getByRole('dialog', { name: 'Estado clínico' });
    // The popover names the current status and offers the options to change it.
    expect(within(dialog).getAllByText('Estable').length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('button', { name: 'Grave' })).toBeInTheDocument();
  });

  it('changes the status when an option is picked', () => {
    const inner = vi.fn();
    const onChange = vi.fn(() => inner);
    renderStatus({ onChange });

    fireEvent.click(screen.getByRole('button', { name: 'Estado: Estable' }));
    fireEvent.click(screen.getByRole('button', { name: 'Grave' }));

    expect(onChange).toHaveBeenCalledWith('status');
    expect(inner).toHaveBeenCalledWith(expect.objectContaining({ target: { value: 'Grave' } }));
  });

  it('flags a critical-empty status (admitted patient without status)', () => {
    renderStatus({
      data: DataFactory.createMockPatient('R1', {
        patientName: 'Juana',
        status: PatientStatus.EMPTY,
      }),
    });
    expect(screen.getByRole('button', { name: 'Sin estado clínico' })).toBeInTheDocument();
    expect(screen.getByTitle('Campo crítico vacío')).toBeInTheDocument();
  });

  it('does not open the popover when read-only', () => {
    renderStatus({ readOnly: true });
    fireEvent.click(screen.getByRole('button', { name: 'Estado: Estable' }));
    expect(screen.queryByRole('dialog', { name: 'Estado clínico' })).not.toBeInTheDocument();
  });
});
