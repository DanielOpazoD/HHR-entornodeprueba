import { expect, type Locator, type Page } from '@playwright/test';

export const getClinicalDiagnosisButton = (row: Locator): Locator =>
  row.getByRole('button', { name: /Editar diagnóstico/i }).first();

// Clinical status moved out of the "editar estado clínico" popover into its own compact colored-dot
// selector (StatusSelect). The dot carries no text — the current status lives in its accessible name
// ("Estado: Grave"), so status assertions read that instead of the button's text content.
export const getClinicalStatusButton = (row: Locator): Locator =>
  row.getByTestId('clinical-status').first();

export const expectClinicalDiagnosis = async (row: Locator, value: string): Promise<void> => {
  await expect(getClinicalDiagnosisButton(row)).toContainText(value);
};

export const expectClinicalStatus = async (row: Locator, value: string): Promise<void> => {
  await expect(getClinicalStatusButton(row)).toHaveAccessibleName(
    new RegExp(`Estado:\\s*${value}`, 'i')
  );
};

export const updateClinicalDiagnosis = async (
  page: Page,
  row: Locator,
  bedId: string,
  value: string
): Promise<void> => {
  await getClinicalDiagnosisButton(row).click();
  await page.getByTestId(`clinical-block-pathology-${bedId}`).fill(value);
  await page.getByTestId(`clinical-block-save-${bedId}`).click();
  await expect(page.getByTestId(`clinical-block-editor-${bedId}`)).toBeHidden();
};
