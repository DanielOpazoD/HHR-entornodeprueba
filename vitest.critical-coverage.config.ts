/// <reference types="vitest" />
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { minsalSharedInteropPlugin } from './scripts/config/minsalSharedInteropPlugin';

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
  plugins: [minsalSharedInteropPlugin(dirname), react()],
  resolve: {
    alias: {
      '@/services/exporters/excelJsModuleLoader': path.resolve(
        dirname,
        'src/services/exporters/excelJsModuleLoader.node.ts'
      ),
      '@': path.resolve(dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/tests/**/*.test.ts', 'src/tests/**/*.test.tsx'],
    exclude: ['stories/**/*', 'node_modules/**/*'],
    maxWorkers: 4,
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
    coverage: {
      enabled: true,
      provider: 'v8',
      all: true,
      include: criticalCoverageInclude,
      reporter: ['text-summary', 'json', 'json-summary'],
      reportsDirectory: 'coverage/critical',
      exclude: [
        'node_modules/',
        'dist/',
        'src/tests/setup.ts',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.stories.tsx',
        '.storybook/',
      ],
    },
  },
});
