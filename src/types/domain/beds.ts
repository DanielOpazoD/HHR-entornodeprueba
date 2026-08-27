export enum BedType {
  UTI = 'UTI',
  UCI = 'UCI',
  MEDIA = 'MEDIA',
}

export interface BedDefinition {
  id: string;
  name: string;
  type: BedType;
  isCuna: boolean;
  isExtra?: boolean;
  /** Extra beds sourced from Rayen that must stay hidden unless they are occupied. */
  activationMode?: 'manual' | 'occupied';
}
