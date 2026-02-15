export interface TopLeftPosition {
  top: number;
  left: number;
}

export type OverlayAnchorRect = Pick<DOMRect, 'top' | 'bottom' | 'left'>;

export type VerticalPlacement = 'top' | 'bottom';

export interface VerticalPlacementPosition extends TopLeftPosition {
  placement: VerticalPlacement;
}

export interface DropDirectionPosition extends TopLeftPosition {
  dropUp: boolean;
}
