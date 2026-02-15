export type CensusMovementActionKind = 'undo' | 'edit' | 'delete';

export interface CensusMovementActionDescriptor {
    kind: CensusMovementActionKind;
    title: string;
    className: string;
    onClick: () => void;
}
