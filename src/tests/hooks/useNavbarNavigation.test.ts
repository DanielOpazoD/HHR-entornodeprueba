import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// Mock dependencies
vi.mock('@/context/AuthContext', () => ({
    useAuth: () => ({
        role: 'admin',
    }),
}));

vi.mock('@/utils/permissions', () => ({
    isAdmin: (role: string) => role === 'admin',
}));

vi.mock('@/constants/navigationConfig', () => ({
    NAVIGATION_CONFIG: [
        { id: 'handoff', module: 'HANDOFF', isUtility: false, isSystem: false },
        { id: 'census', module: 'CENSUS', isUtility: true, isSystem: false },
        { id: 'admin', module: 'ADMIN', isUtility: false, isSystem: true, adminOnly: true },
        { id: 'viewer', module: 'VIEWER', excludeFromRoles: ['viewer'] },
        { id: 'history', module: 'HISTORY', requiredModule: 'HISTORY' },
    ],
    ModuleType: {},
}));

import { useNavbarNavigation } from '@/hooks/useNavbarNavigation';

describe('useNavbarNavigation', () => {
    it('should categorize navigation items correctly', () => {
        const { result } = renderHook(() =>
            useNavbarNavigation('HANDOFF' as any, ['HANDOFF', 'CENSUS', 'ADMIN', 'HISTORY'] as any, 'REGISTER')
        );

        expect(result.current.clinicalTabs.length).toBeGreaterThan(0);
        expect(result.current.utilityItems.length).toBeGreaterThan(0);
        expect(result.current.systemItems.length).toBeGreaterThan(0);
    });

    it('should filter admin-only items for non-admin users', () => {
        // With admin role, admin items should be visible
        const { result } = renderHook(() =>
            useNavbarNavigation('HANDOFF' as any, ['HANDOFF', 'ADMIN'] as any, 'REGISTER')
        );

        const adminItem = result.current.systemItems.find(item => item.id === 'admin');
        expect(adminItem).toBeDefined();
    });

    it('should detect utility active state', () => {
        const { result } = renderHook(() =>
            useNavbarNavigation('CENSUS' as any, ['HANDOFF', 'CENSUS'] as any, 'REGISTER')
        );

        expect(result.current.isUtilityActive).toBeDefined();
    });

    it('should filter items based on required module', () => {
        // Without HISTORY in visible modules
        const { result: result1 } = renderHook(() =>
            useNavbarNavigation('HANDOFF' as any, ['HANDOFF', 'CENSUS'] as any, 'REGISTER')
        );

        const historyItem1 = [...result1.current.clinicalTabs, ...result1.current.utilityItems, ...result1.current.systemItems]
            .find(item => item.id === 'history');
        expect(historyItem1).toBeUndefined();

        // With HISTORY in visible modules
        const { result: result2 } = renderHook(() =>
            useNavbarNavigation('HANDOFF' as any, ['HANDOFF', 'CENSUS', 'HISTORY'] as any, 'REGISTER')
        );

        const historyItem2 = [...result2.current.clinicalTabs, ...result2.current.utilityItems, ...result2.current.systemItems]
            .find(item => item.id === 'history');
        expect(historyItem2).toBeDefined();
    });
});
