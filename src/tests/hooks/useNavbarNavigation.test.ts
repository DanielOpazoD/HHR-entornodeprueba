import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// Mock dependencies
const authState = vi.hoisted(() => ({ role: 'admin' }));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('@/shared/access/operationalAccessPolicy', () => ({
  canUseAdminMaintenanceActions: (role: string) => role === 'admin',
  canAccessAppModuleRoute: ({
    role,
    module,
    visibleModules,
  }: {
    role: string;
    module: string;
    visibleModules?: string[];
  }) => role === 'admin' || Boolean(visibleModules?.includes(module)),
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
  type CurrentModuleArg = Parameters<typeof useNavbarNavigation>[0];
  type VisibleModulesArg = Parameters<typeof useNavbarNavigation>[1];
  type ViewModeArg = Parameters<typeof useNavbarNavigation>[2];

  const useTestHook = (
    currentModule: CurrentModuleArg,
    visibleModules: VisibleModulesArg,
    censusViewMode: ViewModeArg = 'REGISTER'
  ) => useNavbarNavigation(currentModule, visibleModules, censusViewMode);

  it('should categorize navigation items correctly', () => {
    const { result } = renderHook(() =>
      useTestHook(
        'HANDOFF' as unknown as CurrentModuleArg,
        ['HANDOFF', 'CENSUS', 'ADMIN', 'HISTORY'] as unknown as VisibleModulesArg,
        'REGISTER'
      )
    );

    expect(result.current.clinicalTabs.length).toBeGreaterThan(0);
    expect(result.current.utilityItems.length).toBeGreaterThan(0);
    expect(result.current.systemItems.length).toBeGreaterThan(0);
  });

  it('should filter admin-only items for non-admin users', () => {
    authState.role = 'nurse_hospital';
    try {
      const { result } = renderHook(() =>
        useTestHook(
          'HANDOFF' as unknown as CurrentModuleArg,
          ['HANDOFF', 'ADMIN'] as unknown as VisibleModulesArg,
          'REGISTER'
        )
      );

      expect(result.current.systemItems.map(item => item.id)).toEqual([]);
      expect(result.current.clinicalTabs.map(item => item.id)).toContain('handoff');
    } finally {
      authState.role = 'admin';
    }
  });

  it('should detect utility active state', () => {
    const { result } = renderHook(() =>
      useTestHook(
        'CENSUS' as unknown as CurrentModuleArg,
        ['HANDOFF', 'CENSUS'] as unknown as VisibleModulesArg,
        'REGISTER'
      )
    );

    expect(result.current.isUtilityActive).toBe(true);
  });

  it('should filter items based on required module', () => {
    // Without HISTORY in visible modules
    const { result: result1 } = renderHook(() =>
      useTestHook(
        'HANDOFF' as unknown as CurrentModuleArg,
        ['HANDOFF', 'CENSUS'] as unknown as VisibleModulesArg,
        'REGISTER'
      )
    );

    const historyItem1 = [
      ...result1.current.clinicalTabs,
      ...result1.current.utilityItems,
      ...result1.current.systemItems,
    ].find(item => item.id === 'history');
    expect(historyItem1).toBeUndefined();

    // With HISTORY in visible modules
    const { result: result2 } = renderHook(() =>
      useTestHook(
        'HANDOFF' as unknown as CurrentModuleArg,
        ['HANDOFF', 'CENSUS', 'HISTORY'] as unknown as VisibleModulesArg,
        'REGISTER'
      )
    );

    const historyItem2 = [
      ...result2.current.clinicalTabs,
      ...result2.current.utilityItems,
      ...result2.current.systemItems,
    ].find(item => item.id === 'history');
    expect(historyItem2).toBeDefined();
  });
});
