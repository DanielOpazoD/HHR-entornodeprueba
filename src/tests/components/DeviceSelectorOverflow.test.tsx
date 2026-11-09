import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeviceSelector } from '@/components/DeviceSelector';

const FOUR_DEVICES = ['TET', 'VVP#1', 'VVP#2', 'VVP#3'];

// jsdom applies no stylesheet: a badge is off screen when it sits in the print-only wrapper.
const onScreen = (label: string) => !screen.getByText(label).closest('.hidden');

describe('DeviceSelector overflow', () => {
  it.each([
    ['read-only', true],
    ['editable', false],
  ])('shows three devices and «+N» for the rest when %s', (_mode, disabled) => {
    render(
      <DeviceSelector
        devices={FOUR_DEVICES}
        onChange={vi.fn()}
        disabled={disabled}
        currentDate="2026-11-08"
      />
    );

    expect(['TET', 'VVP', 'VVP#2'].map(onScreen)).toEqual([true, true, true]);
    // The fourth still prints, but on screen «+1» stands in for it.
    expect(onScreen('VVP#3')).toBe(false);
    expect(screen.getByTestId('device-overflow')).toHaveTextContent('+1');
  });

  it('opens a card with every device without opening the device menu', () => {
    const onChange = vi.fn();
    render(<DeviceSelector devices={FOUR_DEVICES} onChange={onChange} currentDate="2026-11-08" />);

    fireEvent.click(screen.getByRole('button', { name: 'Ver los 4 dispositivos' }));

    const card = screen.getByRole('dialog', { name: 'Dispositivos del paciente' });
    expect(within(card).getByText('Dispositivos (4)')).toBeInTheDocument();
    expect(within(card).getByText('VVP#3')).toBeInTheDocument();
    expect(within(card).getAllByText(/^(TET|VVP|VVP#2|VVP#3)$/)).toHaveLength(4);
    expect(screen.queryByPlaceholderText(/otro/i)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('adds nothing with three devices or fewer', () => {
    render(<DeviceSelector devices={['TET', 'VVP#1', 'VVP#2']} onChange={vi.fn()} disabled />);

    expect(screen.queryByTestId('device-overflow')).toBeNull();
    expect(['TET', 'VVP', 'VVP#2'].map(onScreen)).toEqual([true, true, true]);
  });
});
