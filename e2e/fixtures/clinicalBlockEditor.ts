import { expect, type Locator, type Page } from '@playwright/test';

export const getClinicalDiagnosisButton = (row: Locator): Locator =>
  row.getByRole('button', { name: /Editar diagnóstico/i }).first();

export const getClinicalStatusButton = (row: Locator): Locator =>
  row.getByRole('button', { name: /Editar estado clínico/i }).first();

export const expectClinicalDiagnosis = async (row: Locator, value: string): Promise<void> => {
  await expect(getClinicalDiagnosisButton(row)).toContainText(value);
};

export const expectClinicalStatus = async (row: Locator, value: string): Promise<void> => {
  await expect(getClinicalStatusButton(row)).toContainText(value);
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
