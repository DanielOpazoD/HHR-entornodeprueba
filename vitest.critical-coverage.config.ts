/// <reference types="vitest" />
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import base from './vitest.config';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const criticalCoverageConfigPath = path.join(
  dirname,
  'scripts',
  'config',
  'critical-coverage-thresholds.json'
);

const criticalCoverageConfig = JSON.parse(fs.readFileSync(criticalCoverageConfigPath, 'utf8'));
const criticalCoverageInclude = [
  ...new Set(
    Object.entries(criticalCoverageConfig.zones || {}).flatMap(([zoneKey, config]) => {
      const sources =
        Array.isArray(config?.sources) && config.sources.length > 0 ? config.sources : [zoneKey];
      return sources.map(source =>
        source.endsWith('.ts') || source.endsWith('.tsx') ? source : `${source}/**/*.{ts,tsx}`
      );
    })
  ),
];

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    exclude: [...(base.test?.exclude ?? []), 'src/tests/services/storage/syncQueueLoad.test.ts'],
    maxWorkers: 4,
    coverage: {
      ...base.test?.coverage,
      enabled: true,
      all: true,
      include: criticalCoverageInclude,
      reporter: ['text-summary', 'json', 'json-summary'],
      reportsDirectory: 'coverage/critical',
      thresholds: undefined,
    },
  },
});
