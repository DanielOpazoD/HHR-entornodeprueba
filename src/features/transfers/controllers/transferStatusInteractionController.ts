import type { TransferStatus } from '@/types/transfers';
import type { DropDirectionPosition, OverlayAnchorRect } from '@/shared/ui/anchoredOverlayTypes';

export type TransferStatusDropdownPosition = DropDirectionPosition;

interface ResolveTransferStatusDropdownPositionParams {
  buttonRect: OverlayAnchorRect;
  viewportHeight: number;
  estimatedPanelHeight?: number;
  offset?: number;
}

export const TRANSFER_STATUS_OPTIONS: readonly TransferStatus[] = [
  'REQUESTED',
  'ACCEPTED',
  'TRANSFERRED',
] as const;

export const resolveTransferStatusDropdownPosition = ({
  buttonRect,
  viewportHeight,
  estimatedPanelHeight = 350,
  offset = 8,
}: ResolveTransferStatusDropdownPositionParams): TransferStatusDropdownPosition => {
  const spaceBelow = viewportHeight - buttonRect.bottom;
  const dropUp = spaceBelow < estimatedPanelHeight;

  return {
    top: dropUp ? buttonRect.top : buttonRect.bottom + offset,
    left: buttonRect.left,
    dropUp,
  };
};
