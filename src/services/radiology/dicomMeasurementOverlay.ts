import type { Types } from '@cornerstonejs/core';
import {
  AngleTool,
  BidirectionalTool,
  CircleROITool,
  CobbAngleTool,
  EllipticalROITool,
  LengthTool,
  ProbeTool,
  RectangleROITool,
  annotation,
  state as toolsState,
} from '@cornerstonejs/tools';
import { dicomStackToolNames } from './dicomStackMeasurement';

// Crosshairs, reference lines and the reference point are guides, not measurements: left out.
const MEASUREMENT_TOOLS = [
  LengthTool,
  AngleTool,
  CobbAngleTool,
  ProbeTool,
  EllipticalROITool,
  RectangleROITool,
  CircleROITool,
  BidirectionalTool,
]
  .map(tool => tool.toolName)
  .concat(Object.values(dicomStackToolNames));

const SVG_NS = 'http://www.w3.org/2000/svg';

export type DicomMeasurementOverlay = { markup: string; width: number; height: number };

type SvgNodeCache = Record<string, Record<string, { domRef?: Element } | undefined> | undefined>;

/**
 * The measurements Cornerstone is drawing on this viewport right now, as a standalone SVG.
 * Cornerstone keys every SVG node by `annotationUID::type::node` per viewport, so only the nodes
 * of measurement annotations are copied, in their drawing order, with the layer's definitions.
 */
export const measurementOverlayFor = (
  viewport: Pick<Types.IViewport, 'id' | 'renderingEngineId' | 'element'>
): DicomMeasurementOverlay | null => {
  const layer = viewport.element.querySelector<SVGSVGElement>('.viewport-element > .svg-layer');
  const cache = (toolsState as unknown as { svgNodeCache?: SvgNodeCache }).svgNodeCache?.[
    `${viewport.id}:${viewport.renderingEngineId}`
  ];
  if (!layer || !cache) return null;
  const measured = new Set(
    MEASUREMENT_TOOLS.flatMap(name => annotation.state.getAnnotations(name, viewport.element) ?? [])
      .map(item => item.annotationUID)
      .filter((uid): uid is string => Boolean(uid))
  );
  const nodes = Object.entries(cache).flatMap(([key, entry]) =>
    entry?.domRef?.isConnected && measured.has(key.split('::')[0]) ? [entry.domRef] : []
  );
  const { width, height } = layer.getBoundingClientRect();
  if (!nodes.length || !width || !height) return null;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  layer.querySelectorAll(':scope > defs').forEach(defs => svg.appendChild(defs.cloneNode(true)));
  nodes.forEach(node => svg.appendChild(node.cloneNode(true)));
  return { markup: new XMLSerializer().serializeToString(svg), width, height };
};

/**
 * The measurements over a frame that just rendered, for videos. Cornerstone redraws them on the
 * animation frame after IMAGE_RENDERED, so they are read one animation frame later. A series
 * without measurements has nothing to wait for.
 */
export const measurementOverlayAfterRender = async (
  viewport: Pick<Types.IViewport, 'id' | 'renderingEngineId' | 'element'>,
  signal: AbortSignal
): Promise<DicomMeasurementOverlay | null> => {
  signal.throwIfAborted();
  const measured = MEASUREMENT_TOOLS.some(
    name => (annotation.state.getAnnotations(name, viewport.element) ?? []).length > 0
  );
  if (!measured) return null;
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      cancelAnimationFrame(handle);
      reject(signal.reason);
    };
    const handle = requestAnimationFrame(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    });
    signal.addEventListener('abort', abort, { once: true });
  });
  return measurementOverlayFor(viewport);
};

/**
 * Draws the measurements over a capture or a video frame. It is drawn on a scratch canvas first:
 * if the browser would taint the target with it, the target keeps the image without measurements
 * instead of failing.
 */
export const drawMeasurementOverlay = async (
  context: CanvasRenderingContext2D,
  overlay: { markup: string },
  width: number,
  height: number
): Promise<boolean> => {
  const url = URL.createObjectURL(new Blob([overlay.markup], { type: 'image/svg+xml' }));
  const scratch = document.createElement('canvas');
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    scratch.width = width;
    scratch.height = height;
    const layer = scratch.getContext('2d');
    if (!layer) return false;
    layer.drawImage(image, 0, 0, width, height);
    layer.getImageData(0, 0, 1, 1);
    context.drawImage(scratch, 0, 0);
    return true;
  } catch {
    return false;
  } finally {
    URL.revokeObjectURL(url);
    scratch.width = scratch.height = 0;
  }
};
