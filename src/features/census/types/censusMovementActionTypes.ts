export type CensusMovementActionKind =
  | 'undo'
  | 'viewDocuments'
  | 'hospitalizationReports'
  | 'edit'
  | 'delete'
  | 'convert';

export interface CensusMovementActionDescriptor {
  kind: CensusMovementActionKind;
  title: string;
  onClick: () => void;
}
