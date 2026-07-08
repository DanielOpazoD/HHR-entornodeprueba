import { describe, expect, it } from 'vitest';
import { readSource } from './excelExport.testUtils';

describe('Excel export configuration', () => {
  describe('Vite configuration for ExcelJS', () => {
    it('exposes ExcelJS as a runtime asset instead of prebundling it', () => {
      const viteConfigSource = readSource('vite.config.ts');
      expect(viteConfigSource).toContain('excelJsRuntimeAssetPlugin');
      expect(viteConfigSource).toContain("fileName: 'vendor/exceljs.bare.min.js'");
      expect(viteConfigSource).toContain("'exceljs.bare.min.js'");
    });

    it('keeps browser runtime loading isolated from the Node test loader', () => {
      const excelModuleLoaderSource = readSource('src/services/exporters/excelJsModuleLoader.ts');
      const nodeExcelModuleLoaderSource = readSource(
        'src/services/exporters/excelJsModuleLoader.node.ts'
      );
      const excelUtilsSource = readSource('src/services/exporters/excelUtils.ts');

      expect(excelModuleLoaderSource).toContain('/vendor/exceljs.bare.min.js');
      expect(excelModuleLoaderSource).toContain(
        "typeof __ENABLE_NODE_EXCEL_LOADER__ !== 'undefined'"
      );
      expect(excelModuleLoaderSource).not.toContain("await import('exceljs')");
      expect(excelModuleLoaderSource).not.toContain('excelJsModuleLoader.node');
      expect(nodeExcelModuleLoaderSource).toContain("await import('exceljs')");
      expect(excelUtilsSource).toContain('loadExcelJSModule');
    });
  });

  describe('chunking policy', () => {
    it('routes Firebase modules into split firebase manual chunks', () => {
      const chunkingPolicySource = readSource('scripts/config/chunkingPolicy.ts');

      expect(chunkingPolicySource).toContain("has('/node_modules/firebase/')");
      expect(chunkingPolicySource).toContain("has('/node_modules/@firebase/')");
      expect(chunkingPolicySource).toContain("return 'vendor-firebase-core';");
      expect(chunkingPolicySource).not.toContain("return 'vendor-firebase-auth';");
      expect(chunkingPolicySource).toContain("return 'vendor-firebase-aux';");
    });
  });
});
