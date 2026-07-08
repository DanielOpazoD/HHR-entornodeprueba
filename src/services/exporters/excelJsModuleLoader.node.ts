interface ExcelJSModuleType {
  Workbook: typeof import('exceljs').Workbook;
  default?:
    | {
        Workbook: typeof import('exceljs').Workbook;
      }
    | typeof import('exceljs').Workbook;
}

const importExcelJsForNode = async (): Promise<unknown> => {
  return await import('exceljs');
};

export const loadExcelJSModule = async (): Promise<ExcelJSModuleType> => {
  return (await importExcelJsForNode()) as ExcelJSModuleType;
};

export const resolveExcelWorkbookConstructor = (
  excelModule: ExcelJSModuleType
): typeof import('exceljs').Workbook => {
  if (excelModule.Workbook) {
    return excelModule.Workbook;
  }

  if (excelModule.default && 'Workbook' in excelModule.default) {
    return excelModule.default.Workbook;
  }

  if (typeof excelModule.default === 'object' && excelModule.default !== null) {
    const defaultObj = excelModule.default as { Workbook?: typeof import('exceljs').Workbook };
    if (defaultObj.Workbook) {
      return defaultObj.Workbook;
    }
  }

  throw new Error('ExcelJS module could not be loaded correctly.');
};
