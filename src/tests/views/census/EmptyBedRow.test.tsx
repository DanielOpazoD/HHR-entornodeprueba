import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyBedRow } from '@/features/census/components/EmptyBedRow';
import { BedType } from '@/types/domain/beds';
import type { TableColumnConfig } from '@/context/TableConfigContext';

describe('EmptyBedRow', () => {
  const columns: TableColumnConfig = {
    actions: 42,
    bed: 96,
    type: 64,
    name: 190,
    rut: 128,
    age: 56,
    diagnosis: 220,
    specialty: 112,
    status: 0,
    admission: 128,
    dmi: 0,
    scores: 0,
    cqx: 0,
    upc: 0,
  };

  it('opens only from the add-patient button, not from the row shell', () => {
    const onClick = vi.fn();

    render(
      <table>
        <tbody>
          <EmptyBedRow
            bed={{ id: 'R4', name: 'R4', type: BedType.MEDIA, isCuna: false }}
            columns={columns}
            visibleColumnCount={9}
            onClick={onClick}
          />
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByText('R4'));
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /agregar paciente/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
