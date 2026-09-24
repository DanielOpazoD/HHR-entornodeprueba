import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SpecialtyRoundEntry } from '@/features/census/components/specialty-round/SpecialtyRoundEntry';

const role = vi.hoisted(() => ({ value: 'admin' }));
const candidates = vi.hoisted(() => ({ count: 1 }));
vi.mock('@/context/DailyRecordContext', () => ({ useDailyRecordBeds: () => ({}) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ role: role.value }) }));
vi.mock('@/hooks/useFeatureFlag', () => ({ useFeatureFlag: () => true }));
vi.mock('@/utils/clinicalTimeZone', () => ({ getClinicalCalendarDateISO: () => '2026-09-24' }));
vi.mock('@/features/census/components/specialty-round/specialtyRoundModel', () => ({
  buildSpecialtyRoundCandidates: () => Array.from({ length: candidates.count }),
}));

describe('SpecialtyRoundEntry', () => {
  beforeEach(() => {
    role.value = 'admin';
    candidates.count = 1;
  });

  it('shows one quiet menu with rules and round actions for an administrator', () => {
    render(<SpecialtyRoundEntry date="2026-09-24" disabled={false} />);
    const group = screen.getByTestId('specialty-actions');
    expect(screen.getByText('Especialidades')).toBeInTheDocument();
    expect(screen.queryByText(/especialidades pendientes en este censo/i)).not.toBeInTheDocument();
    fireEvent.click(within(group).getByText('Especialidades'));
    expect(group).toHaveAttribute('open');
    expect(within(group).getByRole('button', { name: 'Reglas automáticas' })).toBeEnabled();
    expect(within(group).getByRole('button', { name: 'Asignar especialidades' })).toBeEnabled();
  });

  it('hides administration from nurses and blocks the round outside the current day', () => {
    role.value = 'nurse_hospital';
    render(<SpecialtyRoundEntry date="2026-09-23" disabled={false} />);
    expect(screen.queryByText('Especialidades')).not.toBeInTheDocument();
    role.value = 'admin';
    render(<SpecialtyRoundEntry date="2026-09-23" disabled={false} />);
    fireEvent.click(screen.getByText('Especialidades'));
    expect(screen.getByRole('button', { name: 'Asignar especialidades' })).toBeDisabled();
  });

  it('blocks rule editing and the round when census access is read-only', () => {
    render(<SpecialtyRoundEntry date="2026-09-24" disabled />);
    fireEvent.click(screen.getByText('Especialidades'));
    expect(screen.getByRole('button', { name: 'Reglas automáticas' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Asignar especialidades' })).toBeDisabled();
  });
});
