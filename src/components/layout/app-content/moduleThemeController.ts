import type { ModuleType } from '@/constants/navigationConfig';

export type ModuleTheme = 'census' | 'nursing-handoff';

/**
 * Maps a ModuleType to a theme identifier used by the `data-module` attribute.
 * CSS accent variables in index.css respond to this attribute to apply
 * module-specific color palettes.
 *
 * - 'census' (default): dark medical blue
 * - 'nursing-handoff': sky / celeste
 *
 * Laboratory and Clinical Documents are modal-based modules that apply
 * their own `data-module` locally on their modal containers.
 */
export const resolveModuleTheme = (mod: ModuleType): ModuleTheme => {
  switch (mod) {
    case 'NURSING_HANDOFF':
    case 'CUDYR':
      return 'nursing-handoff';
    default:
      return 'census';
  }
};
