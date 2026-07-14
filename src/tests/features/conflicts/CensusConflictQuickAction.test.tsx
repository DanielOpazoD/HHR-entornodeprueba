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
        buttonVariant: 'quick-action',
      })
    );
  });

  it('does not render for non-admin roles', () => {
    mocks.role = 'nurse_hospital';

    const { container } = render(<CensusConflictQuickAction />);

    expect(container).toBeEmptyDOMElement();
    expect(mocks.control).not.toHaveBeenCalled();
  });

  it('does not render without a loaded daily record', () => {
    mocks.record = null;

    const { container } = render(<CensusConflictQuickAction />);

    expect(container).toBeEmptyDOMElement();
    expect(mocks.control).not.toHaveBeenCalled();
  });
});
