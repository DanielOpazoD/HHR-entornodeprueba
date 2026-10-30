import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HandoffChecklistSection } from '@/features/handoff/components/HandoffChecklistSection';
import { HandoffNovedades } from '@/features/handoff/components/HandoffNovedades';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const createDailyRecordFixture = (overrides: Partial<DailyRecord> = {}) =>
  DataFactory.createMockDailyRecord(overrides.date ?? '2026-10-29', overrides);

const initialRecord = () => createDailyRecordFixture({ date: '2026-10-29' });
const checklistProps = {
  isMedical: false,
  deliversList: [],
  receivesList: [],
  nursesList: [],
  onUpdateStaff: vi.fn(),
};

const SharedShiftHarness = () => {
  const [record, setRecord] = useState(initialRecord);
  const [shift, setShift] = useState<'day' | 'night'>('day');
  return (
    <>
      <button onClick={() => setShift(shift === 'day' ? 'night' : 'day')}>Cambiar turno</button>
      <HandoffChecklistSection
        {...checklistProps}
        record={record}
        selectedShift={shift}
        readOnly={false}
        onUpdateChecklist={(scope, field, value) => {
          if (scope === 'shared')
            setRecord(current => ({
              ...current,
              handoffSharedChecklist: { ...current.handoffSharedChecklist, [field]: value },
            }));
        }}
      />
    </>
  );
};

afterEach(() => {
  vi.useRealTimers();
});

describe('shared crash cart checklist UI', () => {
  it('shows the same date and leading-zero code after switching shifts', () => {
    vi.useFakeTimers();
    render(<SharedShiftHarness />);
    fireEvent.change(screen.getByLabelText('Última fecha revisión carro de paro'), {
      target: { value: '2026-10-28' },
    });
    fireEvent.change(screen.getByLabelText('Código'), { target: { value: '00123456' } });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar turno' }));
    expect(screen.getByLabelText('Última fecha revisión carro de paro')).toHaveValue('2026-10-28');
    expect(screen.getByLabelText('Código')).toHaveValue('00123456');
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar turno' }));
    expect(screen.getByLabelText('Código')).toHaveValue('00123456');
    expect(
      screen.queryByText('El código se guarda al completar los 8 dígitos.')
    ).not.toBeInTheDocument();
  });

  it('discards a pending code draft when navigating to another day', () => {
    vi.useFakeTimers();
    const update = vi.fn();
    const props = {
      ...checklistProps,
      selectedShift: 'day' as const,
      readOnly: false,
      onUpdateChecklist: update,
    };
    const { rerender } = render(<HandoffChecklistSection {...props} record={initialRecord()} />);
    fireEvent.change(screen.getByLabelText('Código'), { target: { value: '00123456' } });
    rerender(
      <HandoffChecklistSection
        {...props}
        record={createDailyRecordFixture({
          date: '2026-10-30',
          handoffSharedChecklist: { crashCartCode: '00999999' },
        })}
      />
    );
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByLabelText('Código')).toHaveValue('00999999');
    expect(update).not.toHaveBeenCalled();
  });

  it('saves only complete numeric codes, including clearing a previously saved code', () => {
    vi.useFakeTimers();
    const update = vi.fn();
    render(
      <HandoffChecklistSection
        {...checklistProps}
        record={initialRecord()}
        selectedShift="night"
        readOnly={false}
        onUpdateChecklist={update}
      />
    );
    const code = screen.getByLabelText('Código');
    for (const value of ['123', 'abcdefgh', '123456789']) {
      fireEvent.change(code, { target: { value } });
      act(() => vi.advanceTimersByTime(500));
    }
    expect(update).not.toHaveBeenCalled();
    fireEvent.change(code, { target: { value: '00000001' } });
    act(() => vi.advanceTimersByTime(500));
    expect(update).toHaveBeenLastCalledWith('shared', 'crashCartCode', '00000001');
    fireEvent.change(code, { target: { value: '' } });
    act(() => vi.advanceTimersByTime(500));
    expect(update).toHaveBeenLastCalledWith('shared', 'crashCartCode', '');
  });

  it('disables shared editing for a read-only handoff', () => {
    render(
      <HandoffChecklistSection
        {...checklistProps}
        record={initialRecord()}
        selectedShift="day"
        readOnly
        onUpdateChecklist={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Código')).toBeDisabled();
    expect(screen.getByLabelText('Última fecha revisión carro de paro')).toBeDisabled();
  });

  it('keeps the shared nursing controls out of the medical handoff', () => {
    render(
      <HandoffChecklistSection
        {...checklistProps}
        isMedical
        record={initialRecord()}
        selectedShift="day"
        readOnly={false}
        onUpdateChecklist={vi.fn()}
      />
    );
    expect(screen.queryByLabelText('Código')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Última fecha revisión carro de paro')).not.toBeInTheDocument();
  });

  it('renames the nursing novedades heading', () => {
    render(<HandoffNovedades value="" onChange={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Novedades & Pendientes' })).toBeInTheDocument();
  });
});
