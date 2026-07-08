import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DebouncedInput } from '@/components/ui/DebouncedInput';

describe('DebouncedInput', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces onChange while the user types and fires once with the final value', () => {
    const handleChange = vi.fn();
    render(<DebouncedInput value="" onChange={handleChange} debounceMs={500} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'A' } });
    fireEvent.change(input, { target: { value: 'AB' } });
    fireEvent.change(input, { target: { value: 'ABC' } });

    expect(handleChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(handleChange).toHaveBeenCalledWith('ABC');
  });

  it('flushes the pending edit on blur when the user actually typed', () => {
    const handleChange = vi.fn();
    render(<DebouncedInput value="A" onChange={handleChange} debounceMs={500} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'AB' } });
    fireEvent.blur(input);

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(handleChange).toHaveBeenCalledWith('AB');
  });

  it('does not push a stale localValue on blur when the user did not type', () => {
    // Reproduces the multi-tab truncation bug: the input is focused (e.g.
    // the user clicked into it in tab B before switching to tab A). While
    // focused, the prop value is updated externally (subscription
    // delivers the longer text saved in tab A). The user returns and
    // blurs without typing. The component must NOT push the stale
    // localValue back, since that would silently revert the remote
    // update.
    const handleChange = vi.fn();
    const { rerender } = render(
      <DebouncedInput value="Adenopatias retroperit" onChange={handleChange} debounceMs={500} />
    );
    const input = screen.getByRole('textbox') as HTMLInputElement;

    // Tab B: input gets focus.
    fireEvent.focus(input);
    expect(input.value).toBe('Adenopatias retroperit');

    // Tab A saves the full diagnosis; subscription updates the prop
    // while tab B's input is still focused. localValue must remain the
    // stale snapshot (this is the existing "preserve while focused"
    // contract that prevents focus loss during typing).
    rerender(
      <DebouncedInput
        value="Adenopatias retroperitoneales en estudio"
        onChange={handleChange}
        debounceMs={500}
      />
    );
    expect(input.value).toBe('Adenopatias retroperit');

    // User returns and clicks elsewhere → blur fires WITHOUT having
    // typed anything in this focus session. The fix: do not push
    // localValue, and adopt the remote value into the visible input.
    fireEvent.blur(input);

    expect(handleChange).not.toHaveBeenCalled();
    expect(input.value).toBe('Adenopatias retroperitoneales en estudio');
  });

  it('cancels the pending debounce when blur fires', () => {
    const handleChange = vi.fn();
    render(<DebouncedInput value="" onChange={handleChange} debounceMs={500} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'AB' } });
    fireEvent.blur(input);

    // Blur fired the flush already (1 call). Advancing the timer must
    // not trigger a second call from the cancelled debounce.
    expect(handleChange).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(handleChange).toHaveBeenCalledTimes(1);
  });

  it('adopts the prop value when the input is unfocused and the prop changes', () => {
    const handleChange = vi.fn();
    const { rerender } = render(
      <DebouncedInput value="initial" onChange={handleChange} debounceMs={500} />
    );
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('initial');

    // Remote update while not focused.
    rerender(<DebouncedInput value="updated" onChange={handleChange} debounceMs={500} />);
    expect(input.value).toBe('updated');
    expect(handleChange).not.toHaveBeenCalled();
  });

  it('resets the user-edited flag between focus sessions so a later blur does not push stale data', () => {
    const handleChange = vi.fn();
    const { rerender } = render(
      <DebouncedInput value="A" onChange={handleChange} debounceMs={500} />
    );
    const input = screen.getByRole('textbox') as HTMLInputElement;

    // First focus session: user types and blurs.
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'AB' } });
    fireEvent.blur(input);
    expect(handleChange).toHaveBeenCalledTimes(1);

    // Remote update lands while unfocused.
    rerender(<DebouncedInput value="REMOTE" onChange={handleChange} debounceMs={500} />);

    // Second focus session: user does not type.
    fireEvent.focus(input);
    fireEvent.blur(input);

    // No additional onChange — the flag is properly reset on focus and
    // blur from the previous session does not leak.
    expect(handleChange).toHaveBeenCalledTimes(1);
  });
});
