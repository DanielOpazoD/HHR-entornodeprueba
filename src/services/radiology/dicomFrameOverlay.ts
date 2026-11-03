import type { DicomOrientation } from './dicomRuntimeTypes';

const BACKDROP = 'rgba(0,0,0,.7)';
const edgeSize = (width: number) => Math.max(12, Math.min(22, width / 35));

/** Non-identifying labels shared by PNG and MP4: plane or slice label and LPS edge letters. */
export const drawDicomFrameLabels = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  label: string,
  edges?: DicomOrientation
) => {
  context.font = '14px sans-serif';
  context.textAlign = 'start';
  context.textBaseline = 'alphabetic';
  context.fillStyle = BACKDROP;
  context.fillRect(8, height - 28, Math.min(width - 16, context.measureText(label).width + 12), 22);
  context.fillStyle = 'white';
  context.fillText(label, 14, height - 12);
  if (!edges) return;
  const size = edgeSize(width);
  context.font = `bold ${size}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (const [text, x, y] of [
    [edges.top, width / 2, size],
    [edges.bottom, width / 2, height - size],
    [edges.left, size, height / 2],
    [edges.right, width - size, height / 2],
  ] as const) {
    context.fillStyle = BACKDROP;
    context.fillRect(x - size, y - size * 0.7, size * 2, size * 1.4);
    context.fillStyle = 'white';
    context.fillText(text, x, y);
  }
};

/** Drawn only when the user turns the anonymous profile off; below the top edge letter. */
export const drawDicomFrameIdentity = (
  context: CanvasRenderingContext2D,
  width: number,
  identity: string,
  edges: boolean
) => {
  const top = edges ? Math.ceil(edgeSize(width) * 1.7) + 6 : 8;
  context.font = 'bold 14px sans-serif';
  context.textAlign = 'start';
  context.textBaseline = 'alphabetic';
  context.fillStyle = BACKDROP;
  context.fillRect(8, top, Math.min(width - 16, context.measureText(identity).width + 12), 22);
  context.fillStyle = 'white';
  context.fillText(identity, 14, top + 16, Math.max(1, width - 28));
};
