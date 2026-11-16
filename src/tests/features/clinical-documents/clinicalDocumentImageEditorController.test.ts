// @vitest-environment node
/**
 * Tests for image editor controller (pure logic).
 *
 * Validates alignment style resolution and resize width calculation.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveImageAlignmentStyles,
  resolveImageToolbarPosition,
  calculateResizedWidth,
  IMAGE_MIN_WIDTH_PX,
} from '@/features/clinical-documents/controllers/clinicalDocumentImageEditorController';

describe('resolveImageAlignmentStyles', () => {
  it('returns left-aligned styles', () => {
    const styles = resolveImageAlignmentStyles('left');
    expect(styles.marginLeft).toBe('0');
    expect(styles.marginRight).toBe('auto');
    expect(styles.display).toBe('block');
  });

  it('returns center-aligned styles', () => {
    const styles = resolveImageAlignmentStyles('center');
    expect(styles.marginLeft).toBe('auto');
    expect(styles.marginRight).toBe('auto');
  });

  it('returns right-aligned styles', () => {
    const styles = resolveImageAlignmentStyles('right');
    expect(styles.marginLeft).toBe('auto');
    expect(styles.marginRight).toBe('0');
  });

  it('returns full-width styles with explicit width', () => {
    const styles = resolveImageAlignmentStyles('full');
    expect(styles.width).toBe('100%');
    expect(styles.height).toBe('auto');
    expect(styles.marginLeft).toBe('0');
    expect(styles.marginRight).toBe('0');
  });

  it('clears float on all alignments', () => {
    expect(resolveImageAlignmentStyles('left').float).toBe('');
    expect(resolveImageAlignmentStyles('center').float).toBe('');
    expect(resolveImageAlignmentStyles('right').float).toBe('');
    expect(resolveImageAlignmentStyles('full').float).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Toolbar positioning
// ---------------------------------------------------------------------------

const makeDOMRect = (x: number, y: number, width: number, height: number): DOMRect => ({
  x,
  y,
  top: y,
  left: x,
  bottom: y + height,
  right: x + width,
  width,
  height,
  toJSON: () => '',
});

describe('resolveImageToolbarPosition', () => {
  it('places the toolbar above the image when there is enough space', () => {
    const imageRect = makeDOMRect(100, 200, 300, 150);
    const pos = resolveImageToolbarPosition(imageRect);

    expect(pos.isBelow).toBe(false);
    expect(pos.top).toBeLessThan(imageRect.top);
    expect(pos.left).toBe(imageRect.left + imageRect.width / 2);
  });

  it('places the toolbar below the image when near the top of the viewport', () => {
    const imageRect = makeDOMRect(100, 10, 300, 150);
    const pos = resolveImageToolbarPosition(imageRect);

    expect(pos.isBelow).toBe(true);
    expect(pos.top).toBeGreaterThan(imageRect.bottom);
  });

  it('centers the toolbar horizontally on the image', () => {
    const imageRect = makeDOMRect(50, 200, 400, 200);
    const pos = resolveImageToolbarPosition(imageRect);

    expect(pos.left).toBe(250); // 50 + 400/2
  });
});

describe('calculateResizedWidth', () => {
  it('adds deltaX to start width', () => {
    expect(calculateResizedWidth(200, 50)).toBe(250);
  });

  it('subtracts negative deltaX', () => {
    expect(calculateResizedWidth(200, -50)).toBe(150);
  });

  it('clamps to minimum width', () => {
    expect(calculateResizedWidth(200, -300)).toBe(IMAGE_MIN_WIDTH_PX);
  });

  it('returns minimum for zero start width and negative delta', () => {
    expect(calculateResizedWidth(0, -10)).toBe(IMAGE_MIN_WIDTH_PX);
  });
});
