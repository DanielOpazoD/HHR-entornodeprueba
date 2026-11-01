export interface DeviceInstance {
  id: string;
  type: string;
  /** Stable clinical episode owner; prevents bed-scoped history leakage after moves/discharges. */
  clinicalEpisodeId?: string;
  patientRut?: string;
  patientName?: string;
  installationDate: string;
  installationTime?: string;
  removalDate?: string;
  removalTime?: string;
  /** Absent on legacy instances: never infer origin from dates or editable notes. */
  source?: 'eloisa' | 'manual';
  /** Only absence-based retirement may be undone by a later complete JSON read. */
  removalSource?: 'eloisa-absence' | 'eloisa' | 'manual';
  location?: string;
  status: 'Active' | 'Removed';
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DeviceInfo {
  installationDate?: string;
  removalDate?: string;
  note?: string;
}

export type DeviceDetails = Record<string, DeviceInfo>;

export type DeviceType =
  | 'CVC'
  | 'LA'
  | 'CUP'
  | 'VMNI'
  | 'CNAF'
  | 'TET'
  | 'VVP#1'
  | 'VVP#2'
  | 'VVP#3'
  | string;
