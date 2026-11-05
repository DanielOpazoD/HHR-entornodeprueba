export type CensusMovementActionKind =
  | 'undo'
  | 'viewDocuments'
  | 'hospitalizationReports'
  | 'edit'
  | 'delete'
  | 'convert'
  /** «Paciente no válido»: removes the movement and keeps the sync from filing it again. */
  | 'invalid';

export interface CensusMovementActionDescriptor {
  kind: CensusMovementActionKind;
  title: string;
  onClick: () => void;
}
