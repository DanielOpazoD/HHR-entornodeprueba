export interface TopLeftPosition {
  top: number;
  left: number;
}

export type OverlayAnchorRect = Pick<DOMRect, 'top' | 'bottom' | 'left'> & {
  right?: number;
};

export type VerticalPlacement = 'top' | 'bottom';

export interface VerticalPlacementPosition extends TopLeftPosition {
  placement: VerticalPlacement;
}
