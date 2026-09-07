import { describe, expect, it } from 'vitest';
import { resolveClinicalInitialBlockEditorPosition } from '@/features/census/controllers/clinicalInitialBlockEditorPosition';

const makeRect = (top: number, left: number, width: number, height: number) => ({
  top,
  left,
  bottom: top + height,
  right: left + width,
  width,
  height,
});

describe('resolveClinicalInitialBlockEditorPosition', () => {
  it('opens above the final census row and keeps the complete editor in the viewport', () => {
    const position = resolveClinicalInitialBlockEditorPosition({
      anchorRect: makeRect(690, 860, 430, 28),
      viewportWidth: 1366,
      viewportHeight: 768,
      panelWidth: 384,
      panelHeight: 248,
    });

    expect(position.placement).toBe('top');
    expect(position.top).toBe(438);
    expect(position.top + 248).toBeLessThanOrEqual(760);
  });

  it('opens below a row when the editor fits without scrolling the page', () => {
    const position = resolveClinicalInitialBlockEditorPosition({
      anchorRect: makeRect(120, 300, 430, 28),
      viewportWidth: 1366,
      viewportHeight: 768,
      panelWidth: 384,
      panelHeight: 248,
    });

    expect(position).toMatchObject({ placement: 'bottom', top: 152, left: 346 });
  });

  it('clamps the editor to every viewport edge on a short, narrow display', () => {
    const position = resolveClinicalInitialBlockEditorPosition({
      anchorRect: makeRect(250, 600, 300, 28),
      viewportWidth: 360,
      viewportHeight: 320,
      panelWidth: 384,
      panelHeight: 400,
    });

    expect(position.left).toBe(8);
    expect(position.top).toBe(8);
  });
});
