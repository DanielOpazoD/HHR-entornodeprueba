import { describe, expect, it } from 'vitest';
import {
  resolveTransferStatusDropdownPosition,
  TRANSFER_STATUS_OPTIONS,
} from '@/features/transfers/controllers/transferStatusInteractionController';

describe('transferStatusInteractionController', () => {
  it('keeps dropdown below when there is enough space', () => {
    const position = resolveTransferStatusDropdownPosition({
      buttonRect: { top: 100, bottom: 130, left: 40 },
      viewportHeight: 900,
    });

    expect(position).toEqual({
      top: 138,
      left: 40,
      dropUp: false,
    });
  });

  it('drops up when below space is insufficient', () => {
    const position = resolveTransferStatusDropdownPosition({
      buttonRect: { top: 700, bottom: 740, left: 16 },
      viewportHeight: 960,
      estimatedPanelHeight: 300,
    });

    expect(position).toEqual({
      top: 700,
      left: 16,
      dropUp: true,
    });
  });

  it('exposes stable transfer status options order', () => {
    expect(TRANSFER_STATUS_OPTIONS).toEqual(['REQUESTED', 'ACCEPTED', 'TRANSFERRED']);
  });
});
