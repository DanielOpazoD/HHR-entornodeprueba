/* JScanify/OpenCV processor. Heavy computer-vision work stays off the UI thread. */
/* global cv, jscanify */

self.HTMLCanvasElement = OffscreenCanvas;
self.HTMLImageElement = class HTMLImageElement {};
self.document = {
  createElement(tagName) {
    if (tagName !== 'canvas') throw new Error(`Elemento no soportado en el procesador: ${tagName}`);
    return new OffscreenCanvas(1, 1);
  },
};

const MAX_DETECTION_DIMENSION = 640;
const MAX_SOURCE_DIMENSION = 2000;
const MAX_OUTPUT_DIMENSION = 2200;
const A4_RATIO = Math.SQRT2;
const TILE_SIZE = 96;
const SAMPLE_STEP = 2;
const PAPER_TARGET = 246;
const TONE_PROFILES = Object.freeze({
  scanner: { gamma: 1.01, paperLift: 0.58, shadowBlend: 0.9, saturation: 0.32 },
  grayscale: { gamma: 0.96, paperLift: 0.34, shadowBlend: 0.78, saturation: 0 },
  color: { gamma: 0.94, paperLift: 0.25, shadowBlend: 0.7, saturation: 1.05 },
});
let runtimePromise = null;

const resolveOpenCv = async candidate => {
  const resolvedCandidate =
    candidate && typeof candidate.then === 'function' ? await candidate : candidate;
  if (!resolvedCandidate) throw new Error('OpenCV no quedó disponible en este navegador.');
  if (resolvedCandidate.Mat) return { runtime: resolvedCandidate };
  return new Promise(resolve => {
    const previousHandler = resolvedCandidate.onRuntimeInitialized;
    resolvedCandidate.onRuntimeInitialized = () => {
      if (previousHandler) previousHandler();
      resolve({ runtime: resolvedCandidate });
    };
  });
};

const initialize = (openCvUrl, jscanifyUrl) => {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      importScripts(openCvUrl);
      const { runtime: openCv } = await resolveOpenCv(self.cv);
      self.cv = openCv;
      importScripts(jscanifyUrl);
      if (!self.jscanify) throw new Error('JScanify no quedó disponible en este navegador.');
      return { openCv, Scanner: self.jscanify };
    })();
  }
  return runtimePromise;
};

const distance = (first, second) => Math.hypot(first.x - second.x, first.y - second.y);

const clamp = (value, minimum = 0, maximum = 255) => Math.min(maximum, Math.max(minimum, value));

const smoothstep = (minimum, maximum, value) => {
  const normalized = clamp((value - minimum) / Math.max(1, maximum - minimum), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
};

const luminanceOf = (red, green, blue) => red * 0.2126 + green * 0.7152 + blue * 0.0722;

const histogramPercentile = (histogram, offset, sampleCount, percentile) => {
  const target = sampleCount * percentile;
  let seen = 0;
  for (let value = 0; value < 256; value += 1) {
    seen += histogram[offset + value];
    if (seen >= target) return value;
  }
  return 255;
};

const smoothField = (source, columns, rows) => {
  const result = new Float32Array(source.length);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let total = 0;
      let count = 0;
      for (let y = Math.max(0, row - 1); y <= Math.min(rows - 1, row + 1); y += 1) {
        for (let x = Math.max(0, column - 1); x <= Math.min(columns - 1, column + 1); x += 1) {
          total += source[y * columns + x];
          count += 1;
        }
      }
      result[row * columns + column] = total / count;
    }
  }
  return result;
};

const buildBackgroundField = (pixels, width, height) => {
  const columns = Math.max(1, Math.ceil(width / TILE_SIZE));
  const rows = Math.max(1, Math.ceil(height / TILE_SIZE));
  const cellCount = columns * rows;
  const histograms = new Uint32Array(cellCount * 256);
  const cellSamples = new Uint32Array(cellCount);
  const globalHistogram = new Uint32Array(256);
  let globalSamples = 0;

  for (let y = 0; y < height; y += SAMPLE_STEP) {
    const row = Math.min(rows - 1, Math.floor(y / TILE_SIZE));
    for (let x = 0; x < width; x += SAMPLE_STEP) {
      const pixelOffset = (y * width + x) * 4;
      const luminance = Math.round(
        luminanceOf(pixels[pixelOffset], pixels[pixelOffset + 1], pixels[pixelOffset + 2])
      );
      const column = Math.min(columns - 1, Math.floor(x / TILE_SIZE));
      const cell = row * columns + column;
      histograms[cell * 256 + luminance] += 1;
      cellSamples[cell] += 1;
      globalHistogram[luminance] += 1;
      globalSamples += 1;
    }
  }

  const paperLuminance = new Float32Array(cellCount);
  for (let cell = 0; cell < cellCount; cell += 1) {
    paperLuminance[cell] = histogramPercentile(histograms, cell * 256, cellSamples[cell], 0.78);
  }

  const redTotal = new Float64Array(cellCount);
  const greenTotal = new Float64Array(cellCount);
  const blueTotal = new Float64Array(cellCount);
  const brightSamples = new Uint32Array(cellCount);
  for (let y = 0; y < height; y += SAMPLE_STEP) {
    const row = Math.min(rows - 1, Math.floor(y / TILE_SIZE));
    for (let x = 0; x < width; x += SAMPLE_STEP) {
      const column = Math.min(columns - 1, Math.floor(x / TILE_SIZE));
      const cell = row * columns + column;
      const pixelOffset = (y * width + x) * 4;
      const red = pixels[pixelOffset];
      const green = pixels[pixelOffset + 1];
      const blue = pixels[pixelOffset + 2];
      if (luminanceOf(red, green, blue) < paperLuminance[cell] - 14) continue;
      redTotal[cell] += red;
      greenTotal[cell] += green;
      blueTotal[cell] += blue;
      brightSamples[cell] += 1;
    }
  }

  const red = new Float32Array(cellCount);
  const green = new Float32Array(cellCount);
  const blue = new Float32Array(cellCount);
  for (let cell = 0; cell < cellCount; cell += 1) {
    const count = Math.max(1, brightSamples[cell]);
    const fallback = Math.max(120, paperLuminance[cell]);
    red[cell] = brightSamples[cell] ? redTotal[cell] / count : fallback;
    green[cell] = brightSamples[cell] ? greenTotal[cell] / count : fallback;
    blue[cell] = brightSamples[cell] ? blueTotal[cell] / count : fallback;
  }

  return {
    field: {
      columns,
      rows,
      red: smoothField(red, columns, rows),
      green: smoothField(green, columns, rows),
      blue: smoothField(blue, columns, rows),
    },
    blackPoint: Math.max(0, histogramPercentile(globalHistogram, 0, globalSamples, 0.015) - 6),
  };
};

const interpolateField = (field, columns, rows, x, y) => {
  const fieldX = clamp(x / TILE_SIZE - 0.5, 0, columns - 1);
  const fieldY = clamp(y / TILE_SIZE - 0.5, 0, rows - 1);
  const left = Math.floor(fieldX);
  const right = Math.min(columns - 1, left + 1);
  const top = Math.floor(fieldY);
  const bottom = Math.min(rows - 1, top + 1);
  const horizontal = fieldX - left;
  const vertical = fieldY - top;
  const topValue =
    field[top * columns + left] * (1 - horizontal) + field[top * columns + right] * horizontal;
  const bottomValue =
    field[bottom * columns + left] * (1 - horizontal) +
    field[bottom * columns + right] * horizontal;
  return topValue * (1 - vertical) + bottomValue * vertical;
};

const mapDocumentLuminance = (luminance, blackPoint, mode) => {
  const profile = TONE_PROFILES[mode];
  const normalized = clamp((luminance - blackPoint) / Math.max(80, 252 - blackPoint), 0, 1);
  const curved = 255 * normalized ** profile.gamma;
  const lifted =
    curved +
    (255 - curved) * profile.paperLift * smoothstep(150, 248, luminance) * profile.shadowBlend;
  return Math.round(lifted >= 253 ? 255 : clamp(lifted));
};

const applyDocumentFilter = (context, width, height, mode) => {
  if (mode === 'original') return;
  const imageData = context.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const { field, blackPoint } = buildBackgroundField(pixels, width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const backgroundRed = Math.max(
        96,
        interpolateField(field.red, field.columns, field.rows, x, y)
      );
      const backgroundGreen = Math.max(
        96,
        interpolateField(field.green, field.columns, field.rows, x, y)
      );
      const backgroundBlue = Math.max(
        96,
        interpolateField(field.blue, field.columns, field.rows, x, y)
      );
      const correctedRed = clamp((pixels[offset] * PAPER_TARGET) / backgroundRed);
      const correctedGreen = clamp((pixels[offset + 1] * PAPER_TARGET) / backgroundGreen);
      const correctedBlue = clamp((pixels[offset + 2] * PAPER_TARGET) / backgroundBlue);
      const correctedLuminance = luminanceOf(correctedRed, correctedGreen, correctedBlue);
      const targetLuminance = mapDocumentLuminance(correctedLuminance, blackPoint, mode);

      if (mode === 'grayscale') {
        pixels[offset] = targetLuminance;
        pixels[offset + 1] = targetLuminance;
        pixels[offset + 2] = targetLuminance;
        continue;
      }

      const saturation = TONE_PROFILES[mode].saturation;
      const paperDesaturation = 1 - 0.72 * smoothstep(205, 252, correctedLuminance);
      const chromaScale = saturation * paperDesaturation;
      const toneScale = targetLuminance / Math.max(1, correctedLuminance);
      pixels[offset] = clamp(
        targetLuminance + (correctedRed - correctedLuminance) * chromaScale * toneScale
      );
      pixels[offset + 1] = clamp(
        targetLuminance + (correctedGreen - correctedLuminance) * chromaScale * toneScale
      );
      pixels[offset + 2] = clamp(
        targetLuminance + (correctedBlue - correctedLuminance) * chromaScale * toneScale
      );
    }
  }
  context.putImageData(imageData, 0, 0);
};

const filterImage = async (bytes, mimeType, mode, maximumDimension) => {
  if (!['original', 'color', 'scanner', 'grayscale'].includes(mode)) {
    throw new Error('La apariencia solicitada no es válida.');
  }
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
  try {
    const scale = maximumDimension
      ? Math.min(1, maximumDimension / Math.max(bitmap.width, bitmap.height))
      : 1;
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale))
    );
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    applyDocumentFilter(context, canvas.width, canvas.height, mode);
    const result = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
    return { bytes: await result.arrayBuffer() };
  } finally {
    bitmap.close();
  }
};

const outputDimensions = (width, height, corners) => {
  if (!corners) {
    return height >= width
      ? { width: Math.round(MAX_OUTPUT_DIMENSION / A4_RATIO), height: MAX_OUTPUT_DIMENSION }
      : { width: MAX_OUTPUT_DIMENSION, height: Math.round(MAX_OUTPUT_DIMENSION / A4_RATIO) };
  }
  const paperWidth = Math.max(
    distance(corners.topLeftCorner, corners.topRightCorner),
    distance(corners.bottomLeftCorner, corners.bottomRightCorner)
  );
  const paperHeight = Math.max(
    distance(corners.topLeftCorner, corners.bottomLeftCorner),
    distance(corners.topRightCorner, corners.bottomRightCorner)
  );
  const aspectRatio = Math.min(1.8, Math.max(0.55, paperWidth / paperHeight));
  return aspectRatio <= 1
    ? { width: Math.round(MAX_OUTPUT_DIMENSION * aspectRatio), height: MAX_OUTPUT_DIMENSION }
    : { width: MAX_OUTPUT_DIMENSION, height: Math.round(MAX_OUTPUT_DIMENSION / aspectRatio) };
};

const scalePoint = (point, scaleX, scaleY) => ({
  x: point.x * scaleX,
  y: point.y * scaleY,
});

const normalizePoint = (point, width, height) => ({
  x: Math.min(1, Math.max(0, point.x / width)),
  y: Math.min(1, Math.max(0, point.y / height)),
});

const normalizeCorners = (corners, width, height) => ({
  topLeftCorner: normalizePoint(corners.topLeftCorner, width, height),
  topRightCorner: normalizePoint(corners.topRightCorner, width, height),
  bottomLeftCorner: normalizePoint(corners.bottomLeftCorner, width, height),
  bottomRightCorner: normalizePoint(corners.bottomRightCorner, width, height),
});

const denormalizeCorners = (corners, width, height) => ({
  topLeftCorner: scalePoint(corners.topLeftCorner, width, height),
  topRightCorner: scalePoint(corners.topRightCorner, width, height),
  bottomLeftCorner: scalePoint(corners.bottomLeftCorner, width, height),
  bottomRightCorner: scalePoint(corners.bottomRightCorner, width, height),
});

const defaultNormalizedCorners = () => ({
  topLeftCorner: { x: 0.03, y: 0.03 },
  topRightCorner: { x: 0.97, y: 0.03 },
  bottomLeftCorner: { x: 0.03, y: 0.97 },
  bottomRightCorner: { x: 0.97, y: 0.97 },
});

const detectCorners = (scanner, openCv, sourceCanvas) => {
  const ratio = Math.min(
    1,
    MAX_DETECTION_DIMENSION / Math.max(sourceCanvas.width, sourceCanvas.height)
  );
  const detectionCanvas = new OffscreenCanvas(
    Math.max(1, Math.round(sourceCanvas.width * ratio)),
    Math.max(1, Math.round(sourceCanvas.height * ratio))
  );
  const context = detectionCanvas.getContext('2d');
  context.filter = 'grayscale(1) contrast(1.15) blur(2px)';
  context.drawImage(sourceCanvas, 0, 0, detectionCanvas.width, detectionCanvas.height);

  const imageMat = openCv.imread(detectionCanvas);
  let contour = null;
  try {
    contour = scanner.findPaperContour(imageMat);
    if (!contour) return null;
    const corners = scanner.getCornerPoints(contour);
    const { topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner } = corners;
    if (!topLeftCorner || !topRightCorner || !bottomLeftCorner || !bottomRightCorner) return null;
    const scaleX = sourceCanvas.width / detectionCanvas.width;
    const scaleY = sourceCanvas.height / detectionCanvas.height;
    return {
      topLeftCorner: scalePoint(topLeftCorner, scaleX, scaleY),
      topRightCorner: scalePoint(topRightCorner, scaleX, scaleY),
      bottomLeftCorner: scalePoint(bottomLeftCorner, scaleX, scaleY),
      bottomRightCorner: scalePoint(bottomRightCorner, scaleX, scaleY),
    };
  } finally {
    if (contour) contour.delete();
    imageMat.delete();
    detectionCanvas.width = 1;
    detectionCanvas.height = 1;
  }
};

const processImage = async (runtime, bytes, mimeType, requestedCorners) => {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
  try {
    const ratio = Math.min(1, MAX_SOURCE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const sourceCanvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * ratio)),
      Math.max(1, Math.round(bitmap.height * ratio))
    );
    sourceCanvas.getContext('2d').drawImage(bitmap, 0, 0, sourceCanvas.width, sourceCanvas.height);
    const scanner = new runtime.Scanner();
    const detectedCorners = requestedCorners
      ? denormalizeCorners(requestedCorners, sourceCanvas.width, sourceCanvas.height)
      : detectCorners(scanner, runtime.openCv, sourceCanvas);
    const normalizedCorners = detectedCorners
      ? normalizeCorners(detectedCorners, sourceCanvas.width, sourceCanvas.height)
      : defaultNormalizedCorners();
    const corners = requestedCorners
      ? denormalizeCorners(normalizedCorners, sourceCanvas.width, sourceCanvas.height)
      : detectedCorners;
    const output = outputDimensions(sourceCanvas.width, sourceCanvas.height, corners);
    const extracted = corners
      ? scanner.extractPaper(sourceCanvas, output.width, output.height, corners)
      : null;
    const resultCanvas = extracted || sourceCanvas;
    const [resultBlob, sourceBlob] = await Promise.all([
      resultCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 }),
      sourceCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 }),
    ]);
    const [resultBytes, sourceBytes] = await Promise.all([
      resultBlob.arrayBuffer(),
      sourceBlob.arrayBuffer(),
    ]);
    return {
      bytes: resultBytes,
      sourceBytes,
      corners: normalizedCorners,
      paperDetected: Boolean(extracted),
    };
  } finally {
    bitmap.close();
  }
};

self.onmessage = async event => {
  const message = event.data;
  try {
    if (message.type === 'init') {
      await initialize(message.openCvUrl, message.jscanifyUrl);
      self.postMessage({ type: 'ready' });
      return;
    }
    if (message.type === 'filter') {
      if (!runtimePromise) throw new Error('El procesador todavía no está listo.');
      const result = await filterImage(
        message.bytes,
        message.mimeType,
        message.mode,
        message.maximumDimension
      );
      self.postMessage({ type: 'filtered', id: message.id, ...result }, [result.bytes]);
      return;
    }
    if (message.type !== 'process') return;
    if (!runtimePromise) throw new Error('El procesador todavía no está listo.');
    const result = await processImage(
      await runtimePromise,
      message.bytes,
      message.mimeType,
      message.corners
    );
    self.postMessage({ type: 'processed', id: message.id, ...result }, [
      result.bytes,
      result.sourceBytes,
    ]);
  } catch (error) {
    self.postMessage({
      type: 'error',
      id: message.id,
      message: error instanceof Error ? error.message : 'No se pudo procesar la fotografía.',
    });
  }
};
