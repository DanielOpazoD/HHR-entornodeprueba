/**
 * Geometry of the «Accesos» ring: an annulus cut in four sectors around the explorer disc, drawn
 * in a viewBox centred on 0,0. Angles are in degrees, clockwise from the right, as in SVG.
 */

export type ClinicalAccessSector = 'ficha' | 'laboratory' | 'imaging' | 'documents';

export const RADIAL_VIEW_RADIUS = 92;
export const RADIAL_OUTER_RADIUS = 82;
export const RADIAL_INNER_RADIUS = 33;
export const RADIAL_CORE_RADIUS = 27;
/** Where each topic's icon and its document count sit. */
export const RADIAL_ICON_RADIUS = 47;
export const RADIAL_BADGE_RADIUS = 71;
const SECTOR_GAP = 3;
// Screen margin kept around the ring when the row sits near an edge.
const VIEWPORT_MARGIN = 10;

/** Clockwise from the top, so each arrow key points at its sector. */
export const RADIAL_SECTOR_ARCS: Record<ClinicalAccessSector, { from: number; to: number }> = {
  ficha: { from: -135, to: -45 },
  laboratory: { from: -45, to: 45 },
  imaging: { from: 45, to: 135 },
  documents: { from: 135, to: 225 },
};

export const RADIAL_ARROW_SECTORS: Record<string, ClinicalAccessSector> = {
  ArrowUp: 'ficha',
  ArrowRight: 'laboratory',
  ArrowDown: 'imaging',
  ArrowLeft: 'documents',
};

const round = (value: number): number => Math.round(value * 100) / 100;

export const radialPoint = (radius: number, degrees: number): { x: number; y: number } => {
  const radians = (degrees * Math.PI) / 180;
  return { x: round(radius * Math.cos(radians)), y: round(radius * Math.sin(radians)) };
};

const at = (radius: number, degrees: number): string => {
  const { x, y } = radialPoint(radius, degrees);
  return `${x} ${y}`;
};

// The angle that leaves half the gap at this radius, so the gap keeps one width end to end.
const halfGap = (radius: number): number => (Math.asin(SECTOR_GAP / 2 / radius) * 180) / Math.PI;

export const radialSectorPath = (sector: ClinicalAccessSector): string => {
  const { from, to } = RADIAL_SECTOR_ARCS[sector];
  const outer = RADIAL_OUTER_RADIUS;
  const inner = RADIAL_INNER_RADIUS;
  return [
    `M ${at(outer, from + halfGap(outer))}`,
    `A ${outer} ${outer} 0 0 1 ${at(outer, to - halfGap(outer))}`,
    `L ${at(inner, to - halfGap(inner))}`,
    `A ${inner} ${inner} 0 0 0 ${at(inner, from + halfGap(inner))}`,
    'Z',
  ].join(' ');
};

/**
 * The curve each label is written on. Text runs clockwise except at the bottom, where it runs
 * the other way so it is never upside down; that baseline sits further out because its letters
 * grow towards the centre.
 */
export const radialLabelPath = (sector: ClinicalAccessSector): string => {
  const { from, to } = RADIAL_SECTOR_ARCS[sector];
  if (sector === 'imaging') return `M ${at(71, to)} A 71 71 0 0 0 ${at(71, from)}`;
  return `M ${at(65, from)} A 65 65 0 0 1 ${at(65, to)}`;
};

/** A short accent along the outer edge, shown on the sector under the pointer. */
export const radialAccentPath = (sector: ClinicalAccessSector): string => {
  const { from, to } = RADIAL_SECTOR_ARCS[sector];
  const middle = (from + to) / 2;
  const radius = RADIAL_OUTER_RADIUS - 3;
  return `M ${at(radius, middle - 9)} A ${radius} ${radius} 0 0 1 ${at(radius, middle + 9)}`;
};

export const radialSectorMiddle = (sector: ClinicalAccessSector): number => {
  const { from, to } = RADIAL_SECTOR_ARCS[sector];
  return (from + to) / 2;
};

/** Hairlines between sectors, kept short of both edges. */
export const RADIAL_DIVIDERS = [45, 135, 225, 315].map(degrees => ({
  start: radialPoint(RADIAL_INNER_RADIUS + 5, degrees),
  end: radialPoint(RADIAL_OUTER_RADIUS - 7, degrees),
}));

const clamp = (value: number, size: number): number => {
  const reach = RADIAL_VIEW_RADIUS + VIEWPORT_MARGIN;
  if (size < reach * 2) return size / 2;
  return Math.min(Math.max(value, reach), size - reach);
};

/** Centres the ring on its button, moved in only as far as needed to stay on screen. */
export const resolveRadialCenter = (
  anchor: { left: number; top: number; width: number; height: number },
  viewport: { width: number; height: number }
): { x: number; y: number } => ({
  x: clamp(anchor.left + anchor.width / 2, viewport.width),
  y: clamp(anchor.top + anchor.height / 2, viewport.height),
});
