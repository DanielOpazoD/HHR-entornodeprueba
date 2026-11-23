import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRoleManagement } from '@/features/admin/hooks/useRoleManagement';
import { roleService } from '@/features/admin/services/roleService';
import { restoreConsole, suppressConsole } from '@/tests/utils/consoleTestUtils';

// Mock roleService
vi.mock('@/features/admin/services/roleService', () => ({
  roleService: {
    getRoles: vi.fn(),
    setRole: vi.fn(),
    removeRole: vi.fn(),
    forceSyncUser: vi.fn(),
  },
}));

// Mock window.scrollTo
vi.stubGlobal('scrollTo', vi.fn());

describe('useRoleManagement', () => {
  let consoleSpies: Array<{ mockRestore: () => void }> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(roleService.getRoles).mockResolvedValue({});
    vi.mocked(roleService.forceSyncUser).mockResolvedValue({ success: true });
    consoleSpies = suppressConsole(['error']);
  });

  afterEach(() => {
    restoreConsole(consoleSpies);
  });

  it('should initialize with loading state and load roles', async () => {
    vi.mocked(roleService.getRoles).mockResolvedValue({ 'test@email.com': 'admin' });

    const { result } = renderHook(() => useRoleManagement());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.roles).toEqual({ 'test@email.com': 'admin' });
  });

  it('should validate email format', async () => {
    const { result } = renderHook(() => useRoleManagement());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isValidEmail).toBe(false);

    act(() => {
      result.current.setEmail('invalid-email');
    });
    expect(result.current.isValidEmail).toBe(false);

    act(() => {
      result.current.setEmail('valid@email.com');
    });
    expect(result.current.isValidEmail).toBe(true);
  });

  it('should reset form correctly', async () => {
    const { result } = renderHook(() => useRoleManagement());

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setEmail('test@email.com');
      result.current.setSelectedRole('admin');
    });

    act(() => {
      result.current.resetForm();
    });

    expect(result.current.email).toBe('');
    expect(result.current.selectedRole).toBe('viewer');
  });

  it('should handle edit mode', async () => {
    const { result } = renderHook(() => useRoleManagement());

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleEdit('user@email.com', 'admin');
    });

    expect(result.current.email).toBe('user@email.com');
    expect(result.current.selectedRole).toBe('admin');
    expect(result.current.editingEmail).toBe('user@email.com');
  });

  it('should block editing for legacy roles that are no longer assignable', async () => {
    const { result } = renderHook(() => useRoleManagement());

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleEdit('legacy@email.com', 'editor');
    });

    expect(result.current.editingEmail).toBeNull();
    expect(result.current.message).toEqual({
      type: 'error',
      text: 'Este rol legacy ya no es editable. Quita el acceso y reasigna un rol canónico.',
    });
  });

  it('should handle delete click', async () => {
    const { result } = renderHook(() => useRoleManagement());

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleDeleteClick('delete@email.com');
    });

    expect(result.current.deleteConfirm).toBe('delete@email.com');
  });

  it('should handle role service error gracefully', async () => {
    vi.mocked(roleService.getRoles).mockRejectedValue(new Error('Connection error'));

    const { result } = renderHook(() => useRoleManagement());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.message?.type).toBe('error');
  });

  it('should sync custom claims after saving a role', async () => {
    const { result } = renderHook(() => useRoleManagement());

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setEmail('admin@hospital.cl');
      result.current.setSelectedRole('admin');
    });

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent);
    });

    expect(roleService.setRole).toHaveBeenCalledWith('admin@hospital.cl', 'admin');
    expect(roleService.forceSyncUser).toHaveBeenCalledWith('admin@hospital.cl', 'admin');
    expect(result.current.message?.type).toBe('success');
  });

  it('should keep success message with warning when claim sync fails', async () => {
    vi.mocked(roleService.forceSyncUser).mockRejectedValue(new Error('sync failed'));
    const { result } = renderHook(() => useRoleManagement());

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setEmail('doctor@hospital.cl');
      result.current.setSelectedRole('doctor_urgency');
    });

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent);
    });

    expect(result.current.message?.type).toBe('success');
    expect(result.current.message?.text).toContain('no se pudo sincronizar el claim');
  });
});
