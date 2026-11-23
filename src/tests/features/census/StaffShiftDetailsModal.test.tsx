import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StaffShiftDetailsModal } from '@/features/census/components/StaffShiftDetailsModal';
import { DailyRecordFreshnessGateError } from '@/hooks/controllers/dailyRecordFreshnessGateController';
import type { DailyRecordStaffingDetailsV1 } from '@/types/domain/dailyRecordStaffingDetails';
import { mergeEloisaStaff } from '@/services/staff/eloisaStaffDiscovery';
import type { EloisaStaffIdentity } from '@/services/staff/eloisaStaffIdentity';

// The people Eloísa reports, as the header selector reads them from the staff context.
const staff = vi.hoisted(() => ({ staffIdentities: [] as EloisaStaffIdentity[] }));
vi.mock('@/context/StaffContext', () => ({ useStaffContext: () => staff }));

const buildDetail = (): DailyRecordStaffingDetailsV1 => ({
  day: {
    nurses: [
      {
        id: 'nurse-day-1',
        name: 'Enfermera Claudia',
        role: 'nurse',
        slotType: 'standard',
        standardSlotIndex: 0,
        startTime: '08:00',
        endTime: '20:00',
      },
    ],
    tens: [
      {
        id: 'tens-day-1',
        name: 'Tens Paula',
        role: 'tens',
        slotType: 'standard',
        standardSlotIndex: 0,
        startTime: '08:00',
        endTime: '20:00',
      },
    ],
  },
  night: {
    nurses: [
      {
        id: 'nurse-night-1',
        name: 'Enfermera Noche',
        role: 'nurse',
        slotType: 'standard',
        standardSlotIndex: 0,
        startTime: '20:00',
        endTime: '08:00',
      },
    ],
    tens: [
      {
        id: 'tens-night-1',
        name: 'Tens Noche',
        role: 'tens',
        slotType: 'standard',
        standardSlotIndex: 0,
        startTime: '20:00',
        endTime: '08:00',
      },
    ],
  },
});

describe('StaffShiftDetailsModal', () => {
  it('shows one role at a time and switches shift configuration with tabs', () => {
    render(
      <StaffShiftDetailsModal
        isOpen={true}
        onClose={vi.fn()}
        role="nurse"
        initialShift="day"
        recordDate="2026-02-17"
        detail={buildDetail()}
        nursesList={['Enfermera Claudia']}
        tensList={['Tens Paula']}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByText('Configuración detallada Enfermería')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Turno Largo' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByText(/08:00 - 20:00/)).toBeInTheDocument();
    expect(screen.getByText('Enfermería')).toBeInTheDocument();
    expect(screen.queryByText('TENS')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Turno Noche' }));

    expect(screen.getByRole('tab', { name: 'Turno Noche' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByText(/20:00 - 08:00/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Enfermera Noche')).toBeInTheDocument();
  });

  it('stays open after a refused save, leaves no rejection behind and closes on the retry', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const onClose = vi.fn();
    const onSave = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new DailyRecordFreshnessGateError('Estamos verificando los datos.'))
      .mockResolvedValue(undefined);
    render(
      <StaffShiftDetailsModal
        isOpen
        onClose={onClose}
        role="nurse"
        initialShift="day"
        recordDate="2026-04-03"
        detail={buildDetail()}
        nursesList={[]}
        tensList={[]}
        onSave={onSave}
      />
    );
    const save = screen.getByRole('button', { name: /guardar/i });

    await act(async () => {
      fireEvent.click(save);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(unhandled).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(save).toBeEnabled());

    fireEvent.click(save);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledTimes(2);
    process.off('unhandledRejection', unhandled);
  });

  describe.each([
    { role: 'nurse', sourceRole: 'Enfermera' },
    { role: 'tens', sourceRole: 'TENS' },
  ] as const)('two Eloísa people whose names fold alike ($role)', ({ role, sourceRole }) => {
    // Case and spacing never tell two people apart; marks such as the ñ or an accent do.
    it.each([
      ['Luz Pena', 'Luz Pena'],
      ['Luz Peña', 'Luz Peña'],
      ['LUZ  PENA', 'Luz Pena'],
      ['Luz Pená', 'Vacante'],
    ])('reopens a slot saved as «%s» showing «%s»', (saved, shown) => {
      staff.staffIdentities = mergeEloisaStaff(
        [],
        [
          ['syn1', 'Luz Pena'],
          ['syn2', 'Luz Peña'],
        ].map(([practitionerId, author]) => ({
          practitionerId,
          author,
          role: sourceRole,
          recordedAt: '2026-11-01T12:00',
        }))
      );
      const detail = buildDetail();
      detail.day[role === 'nurse' ? 'nurses' : 'tens'][0].name = saved;
      const onSave = vi.fn();
      render(
        <StaffShiftDetailsModal
          isOpen
          onClose={vi.fn()}
          role={role}
          initialShift="day"
          recordDate="2026-11-12"
          detail={detail}
          nursesList={role === 'nurse' ? ['Luz Pena', 'Luz Peña'] : []}
          tensList={role === 'tens' ? ['Luz Pena', 'Luz Peña'] : []}
          onSave={onSave}
        />
      );
      const [select] = screen.getAllByRole('combobox');
      expect(select).toHaveValue(shown);
      // The slot keeps its saved text readable, as the header selector does.
      const hint = document.getElementById(select.getAttribute('aria-describedby') ?? '');
      expect(hint).toHaveTextContent(shown === 'Vacante' ? saved : shown);
      fireEvent.click(screen.getByRole('button', { name: /guardar/i }));
      expect(onSave.mock.calls[0]?.[0].day[role === 'nurse' ? 'nurses' : 'tens'][0].name).toBe(
        saved
      );
      expect(Array.from((select as HTMLSelectElement).options, option => option.value)).toEqual([
        'Vacante',
        'Luz Pena',
        'Luz Peña',
      ]);
      staff.staffIdentities = [];
    });
  });
});
