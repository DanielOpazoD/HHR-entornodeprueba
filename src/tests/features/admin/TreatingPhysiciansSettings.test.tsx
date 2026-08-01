import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TreatingPhysiciansSettings } from '@/features/admin/components/TreatingPhysiciansSettings';
import { useProfessionalsQuery, useSaveProfessionalsMutation } from '@/hooks/useStaffQuery';

vi.mock('@/hooks/useStaffQuery', () => ({
  useProfessionalsQuery: vi.fn(),
  useSaveProfessionalsMutation: vi.fn(),
}));

const mutate = vi.fn();

describe('TreatingPhysiciansSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useProfessionalsQuery).mockReturnValue({
      data: [
        {
          name: 'Angelica Vargas',
          phone: '',
          rayenPractitionerId: '7947',
          source: 'rayen',
        },
      ],
      isLoading: false,
    } as ReturnType<typeof useProfessionalsQuery>);
    vi.mocked(useSaveProfessionalsMutation).mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useSaveProfessionalsMutation>);
  });

  it('shows the stable Eloísa identity and persists the selected specialty', () => {
    render(<TreatingPhysiciansSettings />);

    expect(screen.getByText('Angelica Vargas')).toBeInTheDocument();
    expect(screen.getByText('ID Eloísa 7947')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Especialidad de Angelica Vargas' }), {
      target: { value: 'Psiquiatría' },
    });

    expect(mutate).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'Angelica Vargas',
        rayenPractitionerId: '7947',
        specialty: 'Psiquiatría',
      }),
    ]);
  });
});
