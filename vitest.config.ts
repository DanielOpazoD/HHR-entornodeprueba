/// <reference types="vitest" />
import fs from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minsalSharedInteropPlugin } from './scripts/config/minsalSharedInteropPlugin';

import { pinTestTimeZone } from './scripts/config/testTimeZone';

pinTestTimeZone();

const dirname = path.dirname(fileURLToPath(import.meta.url));
const unitCoverageThresholdsPath = path.join(
  dirname,
  'scripts',
  'config',
  'unit-coverage-thresholds.json'
);
const unitCoverageThresholds = JSON.parse(fs.readFileSync(unitCoverageThresholdsPath, 'utf8'));

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
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: unitCoverageThresholds,
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
