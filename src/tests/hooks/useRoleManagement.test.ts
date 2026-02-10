import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRoleManagement } from '@/hooks/useRoleManagement';
import { roleService } from '@/services/admin/roleService';

// Mock roleService
vi.mock('@/services/admin/roleService', () => ({
    roleService: {
        getRoles: vi.fn(),
        setRole: vi.fn(),
        removeRole: vi.fn(),
    }
}));

// Mock window.scrollTo
vi.stubGlobal('scrollTo', vi.fn());

describe('useRoleManagement', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(roleService.getRoles).mockResolvedValue({});
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
            result.current.handleEdit('user@email.com', 'editor');
        });

        expect(result.current.email).toBe('user@email.com');
        expect(result.current.selectedRole).toBe('editor');
        expect(result.current.editingEmail).toBe('user@email.com');
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
});
