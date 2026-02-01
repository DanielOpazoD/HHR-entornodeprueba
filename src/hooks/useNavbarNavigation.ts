import { useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { isAdmin } from '@/utils/permissions';
import { NAVIGATION_CONFIG, ModuleType } from '@/constants/navigationConfig';

/**
 * Hook to filter and categorize navigation items based on user roles and permissions.
 */
export const useNavbarNavigation = (
    currentModule: ModuleType,
    visibleModules: readonly ModuleType[],
    censusViewMode: 'REGISTER' | 'ANALYTICS'
) => {
    const { role } = useAuth();
    const isUserAdmin = isAdmin(role);

    const filteredItems = useMemo(() => {
        return NAVIGATION_CONFIG.filter(item => {
            // 1. Admin restricted items
            if (item.adminOnly && !isUserAdmin) return false;

            // 2. Explicit role exclusions
            if (item.excludeFromRoles && role && item.excludeFromRoles.includes(role)) return false;

            // 3. Module visibility (from permissions.ts)
            if (item.requiredModule && !visibleModules.includes(item.requiredModule)) return false;

            return true;
        });
    }, [role, isUserAdmin, visibleModules]);

    // Categorize items in a single pass O(n)
    const { clinicalTabs, utilityItems, systemItems } = useMemo(() => {
        const categories = {
            clinicalTabs: [] as typeof filteredItems,
            utilityItems: [] as typeof filteredItems,
            systemItems: [] as typeof filteredItems
        };

        filteredItems.forEach(item => {
            if (item.isUtility) {
                categories.utilityItems.push(item);
            } else if (item.isSystem) {
                categories.systemItems.push(item);
            } else {
                categories.clinicalTabs.push(item);
            }
        });

        return categories;
    }, [filteredItems]);

    // Determine if any utility module is currently active
    const isUtilityActive = useMemo(() => {
        return utilityItems.some(item => {
            if (item.module !== currentModule) return false;

            // Special check for census modes (Register vs Analytics)
            if (item.censusMode) {
                return censusViewMode === item.censusMode;
            }

            return true;
        });
    }, [utilityItems, currentModule, censusViewMode]);

    return {
        clinicalTabs,
        utilityItems,
        systemItems,
        isUtilityActive
    };
};
