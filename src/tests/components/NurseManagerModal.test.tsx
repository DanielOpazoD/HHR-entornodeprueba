import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const mockUseSaveNursesMutation = vi.fn();
const mockStaffCatalogManagerModal = vi.fn();

vi.mock('@/hooks/useStaffQuery', () => ({
  CatalogReadUnavailableError: class extends Error {},
  useNursesQuery: () => ({ refetch: vi.fn() }),
  useSaveNursesMutation: () => mockUseSaveNursesMutation(),
}));

vi.mock('@/components/modals/StaffCatalogManagerModal', () => ({
  StaffCatalogManagerModal: (props: unknown) => {
    mockStaffCatalogManagerModal(props);
    return <div data-testid="staff-catalog-modal" />;
  },
}));

import { NurseManagerModal } from '@/components/modals/NurseManagerModal';

describe('NurseManagerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSaveNursesMutation.mockReturnValue({
      mutateAsync: vi.fn(),
      error: null,
      isPending: true,
      isError: false,
    });
  });

  it('maps nurses catalog state to StaffCatalogManagerModal', () => {
    const onClose = vi.fn();
    const nursesList = ['Ana Perez', 'Marta Diaz'];

    render(<NurseManagerModal isOpen={true} onClose={onClose} nursesList={nursesList} />);

    expect(mockStaffCatalogManagerModal).toHaveBeenCalledTimes(1);
    expect(mockStaffCatalogManagerModal.mock.calls[0][0]).toMatchObject({
      isOpen: true,
      onClose,
      staffList: nursesList,
      syncing: true,
      hasSyncError: false,
      variant: 'nurse',
    });
  });
});
