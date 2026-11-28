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
  /** CMA and BOX follow occupancy; retired locations remain readable in past and ongoing episodes. */
  activationMode?: 'historical' | 'occupied';
}
