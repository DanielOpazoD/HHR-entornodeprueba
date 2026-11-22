import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('excelJsModuleLoader browser script recovery', () => {
  beforeEach(() => {
    vi.resetModules();
    delete window.ExcelJS;
    document.querySelectorAll('script[data-hhr-exceljs-runtime="true"]').forEach(el => el.remove());
  });

  afterEach(() => {
    delete window.ExcelJS;
    document.querySelectorAll('script[data-hhr-exceljs-runtime="true"]').forEach(el => el.remove());
    vi.unstubAllGlobals();
  });

  it('removes a failed runtime script tag so a later retry injects a fresh script and succeeds', async () => {
    vi.stubGlobal('__ENABLE_NODE_EXCEL_LOADER__', false);
    const { loadExcelJSModule } = await import('../../../services/exporters/excelJsModuleLoader');

    const firstAttempt = loadExcelJSModule();
    const firstScript = document.querySelector<HTMLScriptElement>(
      'script[data-hhr-exceljs-runtime="true"]'
    );
    expect(firstScript).not.toBeNull();
    firstScript!.dispatchEvent(new Event('error'));

    await expect(firstAttempt).rejects.toThrow('Failed to load ExcelJS runtime asset');
    expect(document.querySelector('script[data-hhr-exceljs-runtime="true"]')).toBeNull();

    const fakeWorkbook = class FakeWorkbook {} as unknown as typeof import('exceljs').Workbook;
    const secondAttempt = loadExcelJSModule();
    const secondScript = document.querySelector<HTMLScriptElement>(
      'script[data-hhr-exceljs-runtime="true"]'
    );
    expect(secondScript).not.toBeNull();
    expect(secondScript).not.toBe(firstScript);

    window.ExcelJS = { Workbook: fakeWorkbook };
    secondScript!.dispatchEvent(new Event('load'));

    const loaded = await secondAttempt;
    expect(loaded.Workbook).toBe(fakeWorkbook);
  });
});
