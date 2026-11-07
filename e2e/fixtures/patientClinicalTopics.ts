import type { Page } from '@playwright/test';

export type PatientClinicalTopic =
  | 'Ficha clínica'
  | 'Laboratorio'
  | 'Imágenes'
  | 'Documentos'
  | 'Vista integrada';

/** Opens a patient's topic from the turtle in the bed column, as a mouse user does. */
export const openPatientClinicalTopic = async (
  page: Page,
  bedId: string,
  topic: PatientClinicalTopic
): Promise<void> => {
  // The turtle wakes while the pointer is over the left of the row, up to the name and RUT.
  await page
    .locator(`[data-testid="patient-row"][data-bed-id="${bedId}"] .census-identity-cell`)
    .hover();
  await page.getByTestId(`clinical-topics-trigger-${bedId}`).click();
  await page.getByRole('button', { name: new RegExp(`^${topic}`) }).click();
};
