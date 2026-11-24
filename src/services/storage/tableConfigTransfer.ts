/**
 * Table Configuration JSON Export / Import
 * Loaded lazily on explicit administrator export/import actions.
 */

import { safeJsonParse } from '@/utils/jsonUtils';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { migrateTableConfig, type TableConfig } from './tableConfigService';

/**
 * Export configuration to JSON file
 */
export const exportTableConfig = (config: TableConfig): void => {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `table-config-${getTodayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * Import configuration from JSON file
 */
export const importTableConfig = (file: File): Promise<TableConfig> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const content = e.target?.result as string;
        const config = safeJsonParse<TableConfig | null>(content, null);
        if (!config) {
          throw new Error('Invalid config format: JSON parse failed');
        }

        // Validate structure
        if (!config.columns || typeof config.columns !== 'object') {
          throw new Error('Invalid config format: missing columns');
        }

        // Merge with defaults
        const validConfig: TableConfig = migrateTableConfig(config);

        resolve(validConfig);
      } catch {
        reject(new Error('Invalid JSON file'));
      }
    };
    reader.onerror = () => reject(new Error('Error reading file'));
    reader.readAsText(file);
  });
};
