import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CatalogRemoteSyncError } from '@/services/repositories/contracts/catalogContracts';
import { render } from '@testing-library/react';

const mockUseSaveTensMutation = vi.fn();
const mockStaffCatalogManagerModal = vi.fn();

vi.mock('@/hooks/useStaffQuery', () => ({
  CatalogReadUnavailableError: class extends Error {},
  useTensQuery: () => ({ refetch: vi.fn() }),
  useSaveTensMutation: () => mockUseSaveTensMutation(),
}));

vi.mock('@/components/modals/StaffCatalogManagerModal', () => ({
  StaffCatalogManagerModal: (props: unknown) => {
    mockStaffCatalogManagerModal(props);
    return <div data-testid="staff-catalog-modal" />;
  },
}));

import { TensManagerModal } from '@/components/modals/TensManagerModal';

describe('TensManagerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSaveTensMutation.mockReturnValue({
      mutateAsync: vi.fn(),
      error: new CatalogRemoteSyncError(new Error('synthetic')),
      isPending: false,
      isError: true,
    });
  });

  it('maps tens catalog state to StaffCatalogManagerModal', () => {
    const onClose = vi.fn();
    const tensList = ['Luis Soto'];

    render(<TensManagerModal isOpen={false} onClose={onClose} tensList={tensList} />);

    expect(mockStaffCatalogManagerModal).toHaveBeenCalledTimes(1);
    expect(mockStaffCatalogManagerModal.mock.calls[0][0]).toMatchObject({
      isOpen: false,
      onClose,
      staffList: tensList,
      syncing: false,
      hasSyncError: true,
      variant: 'tens',
    });
  });
});
