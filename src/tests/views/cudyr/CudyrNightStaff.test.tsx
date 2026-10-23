import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CudyrNightStaff } from '@/features/cudyr/components/CudyrNightStaff';
import { reportRecord } from '@/tests/services/cudyr/reportFixtures';

describe('CUDYR night staff', () => {
  it('uses the census night, preserving a nurse also working the day shift', () => {
    const record = {
      ...reportRecord('2026-10-12', {}),
      nursesDayShift: ['Enfermera A', 'Enfermera C'],
      nursesNightShift: ['Enfermera A', 'Enfermera B'],
      handoffNightReceives: ['Enfermera siguiente'],
    };
    render(<CudyrNightStaff date={record.date} record={record} />);
    expect(screen.getByText(/12-10-2026 20:00 → 13-10-2026 08:00/)).toBeInTheDocument();
    expect(screen.getByText('Enfermera A')).toBeInTheDocument();
    expect(screen.getByText('Enfermera B')).toBeInTheDocument();
    expect(screen.queryByText('Enfermera C')).not.toBeInTheDocument();
    expect(screen.queryByText('Enfermera siguiente')).not.toBeInTheDocument();
  });
  it('uses 09:00 when the next day is a weekend and hides stale staff on navigation', () => {
    const record = {
      ...reportRecord('2026-10-12', {}),
      nursesNightShift: ['Personal de otro día'],
    };
    render(<CudyrNightStaff date="2026-10-16" record={record} />);
    expect(screen.getByText(/16-10-2026 20:00 → 17-10-2026 09:00/)).toBeInTheDocument();
    expect(screen.queryByText('Personal de otro día')).not.toBeInTheDocument();
    expect(screen.getByText(/Dotación nocturna no informada/)).toBeInTheDocument();
  });
});
