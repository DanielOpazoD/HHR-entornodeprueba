import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Time24Input, normalizeTime24Input } from '@/components/ui/Time24Input';

describe('normalizeTime24Input', () => {
  it('normalizes 24-hour shorthand drafts to HH:mm', () => {
    expect(normalizeTime24Input('')).toBe('');
    expect(normalizeTime24Input('22:00')).toBe('22:00');
    expect(normalizeTime24Input('2200')).toBe('22:00');
    expect(normalizeTime24Input('0000')).toBe('00:00');
    expect(normalizeTime24Input('9:5')).toBe('09:05');
    expect(normalizeTime24Input('930')).toBe('09:30');
    expect(normalizeTime24Input('9')).toBe('09:00');
    expect(normalizeTime24Input('23')).toBe('23:00');
  });

  it('rejects out-of-range or malformed times', () => {
    expect(normalizeTime24Input('24:00')).toBeNull();
    expect(normalizeTime24Input('25:10')).toBeNull();
    expect(normalizeTime24Input('12:60')).toBeNull();
    expect(normalizeTime24Input('9999')).toBeNull();
    expect(normalizeTime24Input('10:00 PM')).toBeNull();
  });
});

describe('Time24Input', () => {
  it('renders a 24-hour text input instead of native AM/PM time input', () => {
    render(<Time24Input aria-label="Hora de egreso" value="22:00" onValueChange={vi.fn()} />);

    const input = screen.getByLabelText('Hora de egreso') as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input.value).toBe('22:00');
    expect(input.placeholder).toBe('22:00');
  });

  it('inserts colon while typing 4 digits and emits valid HH:mm immediately', () => {
    const onValueChange = vi.fn();
    render(<Time24Input aria-label="Hora" value="" onValueChange={onValueChange} />);

    const input = screen.getByLabelText('Hora') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2200' } });

    expect(input.value).toBe('22:00');
    expect(onValueChange).toHaveBeenCalledWith('22:00');
  });

  it('normalizes shorthand input on blur and emits the normalized 24-hour value', () => {
    const onValueChange = vi.fn();
    render(<Time24Input aria-label="Hora" value="" onValueChange={onValueChange} />);

    const input = screen.getByLabelText('Hora') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '9:5' } });
    expect(onValueChange).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(input.value).toBe('09:05');
    expect(onValueChange).toHaveBeenCalledWith('09:05');
  });

  it('validates against maxTime and flags out-of-range 24h entries', () => {
    const onValueChange = vi.fn();
    render(
      <Time24Input aria-label="Hora" value="" maxTime="21:30" onValueChange={onValueChange} />
    );

    const input = screen.getByLabelText('Hora') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '22:00' } });
    expect(input.validationMessage).toBe('La hora no puede superar 21:30.');

    fireEvent.change(input, { target: { value: '21:15' } });
    expect(input.validationMessage).toBe('');
  });

  it('allows clearing the value back to empty string', () => {
    const onValueChange = vi.fn();
    render(<Time24Input aria-label="Hora" value="14:30" onValueChange={onValueChange} />);

    const input = screen.getByLabelText('Hora') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });

    expect(input.value).toBe('');
    expect(onValueChange).toHaveBeenCalledWith('');
  });
});
