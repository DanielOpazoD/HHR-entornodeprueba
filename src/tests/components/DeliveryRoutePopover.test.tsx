import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DeliveryRoutePopover } from '@/features/census/components/patient-row/DeliveryRoutePopover';

describe('DeliveryRoutePopover', () => {
  it('opens popover and saves selected route/date', () => {
    const onSave = vi.fn();

    render(<DeliveryRoutePopover onSave={onSave} />);

    fireEvent.click(screen.getByTitle('Vía del parto'));
    fireEvent.click(screen.getByRole('button', { name: 'Vaginal' }));
    const dateInput = document.querySelector('input[type="date"]');
    if (!dateInput) {
      throw new Error('Date input not found');
    }
    fireEvent.change(dateInput, { target: { value: '2026-02-15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(onSave).toHaveBeenCalledWith('Vaginal', '2026-02-15');
  });

  it('clears persisted delivery route data', () => {
    const onSave = vi.fn();

    render(
      <DeliveryRoutePopover deliveryRoute="Cesárea" deliveryDate="2026-02-14" onSave={onSave} />
    );

    fireEvent.click(screen.getByTitle(/Cesárea/i));
    fireEvent.click(screen.getByTitle('Limpiar'));

    expect(onSave).toHaveBeenCalledWith(undefined, undefined);
  });

  it('closes on outside click', () => {
    render(<DeliveryRoutePopover onSave={vi.fn()} />);

    fireEvent.click(screen.getByTitle('Vía del parto'));
    expect(screen.getByText('Vía del Parto')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('Vía del Parto')).not.toBeInTheDocument();
  });
});
