export interface HospitalizationEvent {
  id: string;
  type: 'Ingreso' | 'Egreso' | 'Traslado' | 'Fallecimiento';
  date: string;
  diagnosis: string;
  bedName?: string;
  receivingCenter?: string;
  isEvacuation?: boolean;
}

export interface MasterPatient {
  rut: string;
  fullName: string;
  birthDate?: string;
  commune?: string;
  address?: string;
  phone?: string;
  forecast?: string;
  gender?: string;
  lastAdmission?: string;
  lastDischarge?: string;
  /**
   * Rayen encounter id (`encId`) of the patient's most recent episode. Captured from the active
   * census (where the id lives) so it survives discharge — the daily-record discharge can lose it
   * (a patient discharged before syncing is a stub). Enables querying a discharged patient's Ficha
   * Médico data by encId later (RUT → encId index).
   */
  lastClinicalEpisodeId?: string;
  hospitalizations?: HospitalizationEvent[];
  vitalStatus?: 'Vivo' | 'Fallecido';
  createdAt: number;
  updatedAt: number;
}
