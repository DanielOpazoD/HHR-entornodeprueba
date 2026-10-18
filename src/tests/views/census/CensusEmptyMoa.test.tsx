import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CensusEmptyMoa } from '@/features/census/components/CensusEmptyMoa';

let candidate: {
  onload?: () => void;
  onerror?: () => void;
  decode: () => Promise<void>;
  naturalWidth: number;
  naturalHeight: number;
  src: string;
};
beforeEach(() => {
  vi.stubGlobal(
    'Image',
    vi.fn(function () {
      candidate = {
        decode: vi.fn().mockResolvedValue(undefined),
        naturalWidth: 1728,
        naturalHeight: 168,
        src: '',
      };
      return candidate;
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('CensusEmptyMoa', () => {
  it('retains the current animation until the next sprite is decoded, without the default Moa', async () => {
    render(<CensusEmptyMoa />);
    const button = screen.getByRole('button', { name: 'Cambiar animación de Moa' });
    fireEvent.load(button.querySelector('.moa-scene-frames')!);
    const initial = button.querySelector('[data-moa-scene]')?.getAttribute('data-moa-scene');
    fireEvent.click(button);
    expect(button.querySelector('[data-moa-scene]')?.getAttribute('data-moa-scene')).toBe(initial);
    expect(button.querySelector('.moa-sequence-placeholder')).not.toBeInTheDocument();
    await act(async () => {
      candidate.onload?.();
    });
    expect(button.querySelector('[data-moa-scene]')?.getAttribute('data-moa-scene')).not.toBe(
      initial
    );
    expect(button.querySelector('.moa-sequence-placeholder')).not.toBeInTheDocument();
    expect(button.querySelector('img')).toHaveAttribute('data-ready', 'true');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('keeps the current scene on download failure and permits another click', () => {
    render(<CensusEmptyMoa />);
    const button = screen.getByRole('button');
    const initial = button.querySelector('[data-moa-scene]')?.getAttribute('data-moa-scene');
    fireEvent.click(button);
    act(() => candidate.onerror?.());
    expect(button).toBeEnabled();
    expect(button.querySelector('[data-moa-scene]')?.getAttribute('data-moa-scene')).toBe(initial);
  });
  it('recovers from a stalled preload without flashing the default scene', () => {
    vi.useFakeTimers();
    render(<CensusEmptyMoa />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(button).toBeDisabled();
    act(() => vi.advanceTimersByTime(10_000));
    expect(button).toBeEnabled();
  });
});
