import type { Page } from '@playwright/test';

export type PatientClinicalTopic =
  | 'Ficha clínica'
  | 'Laboratorio'
  | 'Imágenes'
  | 'Documentos'
  | 'Explorador clínico';

const ACCESS_KEY: Record<PatientClinicalTopic, string> = {
  'Ficha clínica': 'ficha',
  Laboratorio: 'laboratory',
  Imágenes: 'imaging',
  Documentos: 'documents',
  'Explorador clínico': 'explorer',
};

/** Opens a patient's topic as a user does: the bed's manutara, then its sector of the ring. */
export const openPatientClinicalTopic = async (
  page: Page,
  bedId: string,
  topic: PatientClinicalTopic
): Promise<void> => {
  await page.getByTestId(`clinical-access-${bedId}`).click();
  await page.getByTestId(`clinical-access-${ACCESS_KEY[topic]}-${bedId}`).click();
};
