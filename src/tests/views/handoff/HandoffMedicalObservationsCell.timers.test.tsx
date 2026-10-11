import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HandoffMedicalObservationsCell } from '@/features/handoff/components/HandoffMedicalObservationsCell';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { MedicalHandoffEntry } from '@/domain/handoff/patientContracts';
const rendered = vi.hoisted(() => vi.fn());
vi.mock('@/features/handoff/components/MedicalHandoffObservationEntry', () => ({
  MedicalHandoffObservationEntry: ({
    entry,
    onEntryNoteChange,
  }: {
    entry: MedicalHandoffEntry;
    onEntryNoteChange: (id: string, value: string) => void;
  }) => {
    rendered();
    return (
      <input
        aria-label={entry.id}
        value={entry.note}
        onChange={event => onEntryNoteChange(entry.id, event.target.value)}
      />
    );
  },
}));
const patient = DataFactory.createMockPatient('R1', {
  medicalHandoffEntries: [
    { id: 'entry-a', specialty: 'Medicina Interna', note: 'Persistida A' },
    { id: 'entry-b', specialty: 'Medicina Interna', note: 'Persistida B' },
  ],
});
const setup = () => {
  const onChange = vi.fn();
  const view = render(
    <table>
      <tbody>
        <HandoffMedicalObservationsCell
          patient={patient}
          reportDate="2026-10-03"
          isFieldReadOnly={false}
          primaryNoteValue=""
          onPrimaryNoteChange={vi.fn()}
          onEntryNoteChange={onChange}
        />
      </tbody>
    </table>
  );
  return { ...view, onChange };
};
beforeEach(() => {
  vi.useFakeTimers();
  rendered.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe('medical draft timer ownership', () => {
  it('replaces the previous deadline for repeated edits and stays idle until expiry', () => {
    const view = setup();
    fireEvent.change(screen.getByLabelText('entry-a'), { target: { value: 'Borrador 1' } });
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.change(screen.getByLabelText('entry-a'), { target: { value: 'Borrador 2' } });
    expect(vi.getTimerCount()).toBe(1);
    const renderCount = rendered.mock.calls.length;
    act(() => vi.advanceTimersByTime(1500));
    expect(screen.getByLabelText('entry-a')).toHaveValue('Borrador 2');
    expect(rendered).toHaveBeenCalledTimes(renderCount);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByLabelText('entry-a')).toHaveValue('Persistida A');
    expect(view.onChange.mock.calls).toEqual([
      ['entry-a', 'Borrador 1'],
      ['entry-a', 'Borrador 2'],
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('expires different drafts independently and cancels remaining deadlines on unmount', () => {
    const view = setup();
    fireEvent.change(screen.getByLabelText('entry-a'), { target: { value: 'Borrador A' } });
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.change(screen.getByLabelText('entry-b'), { target: { value: 'Borrador B' } });
    expect(vi.getTimerCount()).toBe(2);
    act(() => vi.advanceTimersByTime(1500));
    expect(screen.getByLabelText('entry-a')).toHaveValue('Persistida A');
    expect(screen.getByLabelText('entry-b')).toHaveValue('Borrador B');
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
