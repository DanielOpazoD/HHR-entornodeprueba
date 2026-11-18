import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { CatalogRemoteSyncError } from '@/services/repositories/contracts/catalogContracts';

const mockSaveMutation = { nurse: vi.fn(), tens: vi.fn() };
const mockStaffCatalogManagerModal = vi.fn();

vi.mock('@/hooks/useStaffQuery', () => ({
  CatalogReadUnavailableError: class extends Error {},
  useNursesQuery: () => ({ refetch: vi.fn() }),
  useTensQuery: () => ({ refetch: vi.fn() }),
  useSaveNursesMutation: () => mockSaveMutation.nurse(),
  useSaveTensMutation: () => mockSaveMutation.tens(),
}));

vi.mock('@/components/modals/StaffCatalogManagerModal', () => ({
  StaffCatalogManagerModal: (props: unknown) => {
    mockStaffCatalogManagerModal(props);
    return <div data-testid="staff-catalog-modal" />;
  },
}));

import { StaffManagerModal } from '@/components/modals/StaffManagerModal';

describe('StaffManagerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveMutation.nurse.mockReturnValue({
      mutateAsync: vi.fn(),
      error: null,
      isPending: true,
      isError: false,
    });
    mockSaveMutation.tens.mockReturnValue({
      mutateAsync: vi.fn(),
      error: new CatalogRemoteSyncError(new Error('synthetic')),
      isPending: false,
      isError: true,
    });
  });

  it('maps the nurses catalog state to StaffCatalogManagerModal', () => {
    const onClose = vi.fn();
    const staffList = ['Ana Perez', 'Marta Diaz'];

    render(<StaffManagerModal role="nurse" isOpen onClose={onClose} staffList={staffList} />);

    expect(mockSaveMutation.tens).not.toHaveBeenCalled();
    expect(mockStaffCatalogManagerModal).toHaveBeenCalledTimes(1);
    expect(mockStaffCatalogManagerModal.mock.calls[0][0]).toMatchObject({
      isOpen: true,
      onClose,
      staffList,
      syncing: true,
      hasSyncError: false,
      variant: 'nurse',
    });
  });

  it('maps the TENS catalog state to StaffCatalogManagerModal', () => {
    const onClose = vi.fn();
    const staffList = ['Luis Soto'];

    render(
      <StaffManagerModal role="tens" isOpen={false} onClose={onClose} staffList={staffList} />
    );

    expect(mockSaveMutation.nurse).not.toHaveBeenCalled();
    expect(mockStaffCatalogManagerModal).toHaveBeenCalledTimes(1);
    expect(mockStaffCatalogManagerModal.mock.calls[0][0]).toMatchObject({
      isOpen: false,
      onClose,
      staffList,
      syncing: false,
      hasSyncError: true,
      variant: 'tens',
    });
  });
});
