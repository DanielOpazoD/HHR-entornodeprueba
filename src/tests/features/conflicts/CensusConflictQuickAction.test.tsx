import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  role: 'admin' as string,
  record: { date: '2026-07-13' } as { date: string } | null,
  control: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ role: mocks.role }),
}));

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: () => ({ record: mocks.record }),
}));

vi.mock('@/components/clinical-conflicts/ClinicalConflictCenterControl', () => ({
  ClinicalConflictCenterControl: (props: Record<string, unknown>) => {
    mocks.control(props);
    return <button data-testid="conflict-versions-button">Conflictos HHR</button>;
  },
}));

import { CensusToolbarLoadingActions } from '@/components/layout/date-strip/CensusToolbarLoadingActions';
import { CensusConflictQuickAction } from '@/components/clinical-conflicts/CensusConflictQuickAction';

describe('CensusConflictQuickAction', () => {
  beforeEach(() => {
    mocks.role = 'admin';
    mocks.record = { date: '2026-07-13' };
    mocks.control.mockClear();
  });

  it('renders the HHR conflict entrypoint for administrators', () => {
    render(<CensusConflictQuickAction />);

    expect(screen.getByTestId('conflict-versions-button')).toBeInTheDocument();
    expect(mocks.control).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-07-13',
        scope: 'census',
        buttonLabel: 'Conflictos HHR',
        buttonVariant: 'menu',
      })
    );
  });

  it.each([
    'nurse_hospital',
    'doctor_urgency',
    'doctor_specialist',
    'viewer',
    'editor',
    'nurse',
    '',
  ])('does not render for %s', role => {
    mocks.role = role;

    const { container } = render(<CensusConflictQuickAction />);

    expect(container).toBeEmptyDOMElement();
    expect(mocks.control).not.toHaveBeenCalled();
  });

  it('does not reserve a conflict icon in the admin loading toolbar', () => {
    render(<CensusToolbarLoadingActions />);
    expect(screen.queryByTestId('conflict-versions-loading')).not.toBeInTheDocument();
  });

  it('keeps a disabled entrypoint without initializing conflicts while the record loads', () => {
    mocks.record = null;

    render(<CensusConflictQuickAction />);

    expect(screen.getByTestId('conflict-versions-loading')).toBeDisabled();
    expect(mocks.control).not.toHaveBeenCalled();
  });
});
