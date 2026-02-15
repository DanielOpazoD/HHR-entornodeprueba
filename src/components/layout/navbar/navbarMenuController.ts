import type { ModuleType, NavItemConfig } from '@/constants/navigationConfig';

interface ResolveNavbarMenuActionInput {
  item: NavItemConfig;
}

interface NavbarMenuActionResolution {
  moduleToChange?: ModuleType;
  shouldOpenSettings: boolean;
}

export const resolveNavbarMenuAction = ({
  item,
}: ResolveNavbarMenuActionInput): NavbarMenuActionResolution => {
  if (item.actionType === 'MODULE_CHANGE') {
    return {
      moduleToChange: item.module,
      shouldOpenSettings: false,
    };
  }

  if (item.actionType === 'SETTINGS') {
    return {
      shouldOpenSettings: true,
    };
  }

  return {
    shouldOpenSettings: false,
  };
};
