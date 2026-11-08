import type { Page } from '@playwright/test';

export type PatientClinicalTopic = 'Ficha clínica' | 'Laboratorio' | 'Imágenes' | 'Documentos';

const ACCESS_KEY: Record<PatientClinicalTopic, string> = {
  'Ficha clínica': 'ficha',
  Laboratorio: 'laboratory',
  Imágenes: 'imaging',
  Documentos: 'documents',
};

/** Opens a patient's topic from its bed's «Accesos» cell, one click as a user does. */
export const openPatientClinicalTopic = async (
  page: Page,
  bedId: string,
  topic: PatientClinicalTopic
): Promise<void> => {
  await page.getByTestId(`clinical-access-${ACCESS_KEY[topic]}-${bedId}`).click();
};
