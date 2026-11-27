import { readResponseWithinLimit } from './lib/bounded-response';
import { safeErrorLog } from './lib/safe-error-message';
import {
  buildCorsHeaders,
  buildCorsPreflightResponse,
  buildJsonResponse,
  buildTooManyRequestsResponse,
  getClientIp,
  getRequestOrigin,
  isOriginAllowed,
  isRateLimited,
  type NetlifyEventLike,
} from './lib/http';

interface TransformOptions {
  width: number;
  quality: number;
}

interface PrescriptionImageProxyDependencies {
  fetch: typeof fetch;
  transformImage: (input: Uint8Array, options: TransformOptions) => Promise<Uint8Array | Buffer>;
  timeoutMs?: number;
  maxImageBytes?: number;
}

const MIN_WIDTH = 360;
const MAX_WIDTH = 1200;
const MIN_QUALITY = 40;
const MAX_QUALITY = 80;
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_SHARP_INPUT_PIXELS = 40_000_000;
const RATE_LIMIT_MAX_PER_MINUTE = 120;

const parseBoundedNumber = (
  value: string | null,
  fallback: number,
  min: number,
  max: number
): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
};

/**
 * Verifies actual raster image magic bytes for the fallback passthrough path so a spoofed
 * upstream Content-Type header can never smuggle HTML/SVG/scripts through the proxy.
 */
const detectPassthroughImageType = (bytes: Uint8Array): string | null => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
};

const decodePathSegment = (value: string | undefined): string => {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
};

const FIREBASE_STORAGE_OBJECT_PATH = /^\/v0\/b\/([^/]+)\/o\/([^/]+)$/;

/** HHR's own Storage bucket. Without it configured, no remote source is allowed. */
const resolveAllowedStorageBuckets = (): string[] => {
  const projectId = String(process.env.VITE_FIREBASE_PROJECT_ID || '').trim();
  return [
    String(process.env.VITE_FIREBASE_STORAGE_BUCKET || '').trim(),
    projectId ? `${projectId}.firebasestorage.app` : '',
    projectId ? `${projectId}.appspot.com` : '',
  ].filter(Boolean);
};

const hasUnsafeStorageObjectSegments = (objectPath: string): boolean => {
  if (!objectPath || objectPath.includes('\\') || objectPath.includes('\0')) return true;
  if (objectPath.includes('//')) return true;
  return objectPath.split('/').some(segment => segment === '.' || segment === '..');
};

const isAllowedFirebasePrescriptionUrl = (urlValue: string): boolean => {
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(urlValue);
  } catch {
    return false;
  }

  if (sourceUrl.protocol !== 'https:') return false;
  if (sourceUrl.hostname !== 'firebasestorage.googleapis.com') return false;
  if (sourceUrl.username || sourceUrl.password || sourceUrl.port) return false;
  if (sourceUrl.searchParams.get('alt') !== 'media') return false;

  const match = sourceUrl.pathname.match(FIREBASE_STORAGE_OBJECT_PATH);
  if (!match) return false;

  const bucket = decodePathSegment(match[1]);
  const objectPath = decodePathSegment(match[2]);
  if (!resolveAllowedStorageBuckets().includes(bucket)) return false;
  if (!objectPath.startsWith('prescriptions/') || hasUnsafeStorageObjectSegments(objectPath)) {
    return false;
  }

  return true;
};

const isLocalFixtureProxyEnabled = (): boolean =>
  process.env.HHR_ALLOW_PRESCRIPTION_IMAGE_PROXY_FIXTURE === 'true';

const isAllowedLocalFixtureUrl = (urlValue: string): boolean => {
  if (!isLocalFixtureProxyEnabled()) return false;

  let sourceUrl: URL;
  try {
    sourceUrl = new URL(urlValue);
  } catch {
    return false;
  }

  if (sourceUrl.protocol !== 'http:') return false;
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(sourceUrl.hostname);
};

const isAllowedPrescriptionImageSource = (urlValue: string): boolean =>
  isAllowedFirebasePrescriptionUrl(urlValue) || isAllowedLocalFixtureUrl(urlValue);

const defaultTransformImage = async (
  input: Uint8Array,
  options: TransformOptions
): Promise<Buffer> => {
  const sharp = (await import('sharp')).default;
  return sharp(input, {
    failOn: 'none',
    limitInputPixels: MAX_SHARP_INPUT_PIXELS,
    sequentialRead: true,
  })
    .rotate()
    .resize({ width: options.width, withoutEnlargement: true })
    .jpeg({ quality: options.quality, mozjpeg: true })
    .toBuffer();
};

export const createPrescriptionImageProxyHandler =
  (
    dependencies: PrescriptionImageProxyDependencies = {
      fetch,
      transformImage: defaultTransformImage,
    }
  ) =>
  async (event: NetlifyEventLike) => {
    const requestOrigin = getRequestOrigin(event);
    const corsHeaders = buildCorsHeaders(requestOrigin, {
      allowedMethods: 'GET,OPTIONS',
      extraHeaders: { 'Cache-Control': 'no-store' },
    });

    if (!isOriginAllowed(requestOrigin)) {
      return buildJsonResponse(403, { error: 'Origin not allowed' }, { requestOrigin });
    }

    if (event.httpMethod === 'OPTIONS') {
      return buildCorsPreflightResponse(requestOrigin, {
        allowedMethods: 'GET,OPTIONS',
        extraHeaders: { 'Cache-Control': 'no-store' },
      });
    }

    if (event.httpMethod !== 'GET') {
      return buildJsonResponse(405, { error: 'Method not allowed' }, { requestOrigin });
    }

    if (
      isRateLimited(`prescription-image:${getClientIp(event)}`, {
        maxPerWindow: RATE_LIMIT_MAX_PER_MINUTE,
        windowMs: 60_000,
      })
    ) {
      return buildTooManyRequestsResponse(requestOrigin);
    }

    const params = new URLSearchParams(event.rawQuery ?? '');
    const sourceUrl = params.get('url') ?? '';
    if (!isAllowedPrescriptionImageSource(sourceUrl)) {
      return buildJsonResponse(
        400,
        { error: 'Invalid prescription image source.' },
        { requestOrigin }
      );
    }

    const width = parseBoundedNumber(params.get('w'), 760, MIN_WIDTH, MAX_WIDTH);
    const quality = parseBoundedNumber(params.get('q'), 58, MIN_QUALITY, MAX_QUALITY);
    const timeoutMs = dependencies.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    const maxImageBytes = dependencies.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const upstream = await dependencies.fetch(sourceUrl, {
        signal: controller.signal,
        redirect: 'error',
      });
      if (!upstream.ok) {
        return buildJsonResponse(
          502,
          { error: `Image source responded with ${upstream.status}.` },
          { requestOrigin }
        );
      }

      const boundedBytes = await readResponseWithinLimit(upstream, maxImageBytes);
      if (!boundedBytes) {
        return buildJsonResponse(
          413,
          { error: 'La imagen de receta supera el tamaño máximo permitido.' },
          { requestOrigin }
        );
      }

      const bytes = new Uint8Array(
        boundedBytes.buffer,
        boundedBytes.byteOffset,
        boundedBytes.byteLength
      );
      let transformed: Uint8Array | Buffer = bytes;
      let contentType = 'image/jpeg';
      let optimizationStatus = 'fallback';

      try {
        transformed = await dependencies.transformImage(bytes, { width, quality });
        contentType = 'image/jpeg';
        optimizationStatus = 'optimized';
      } catch (transformError) {
        console.warn('Prescription image optimization fallback', safeErrorLog(transformError));
        const detectedType = detectPassthroughImageType(bytes);
        if (!detectedType) {
          return buildJsonResponse(
            415,
            { error: 'Unsupported prescription image type.' },
            { requestOrigin }
          );
        }
        contentType = detectedType;
      }

      return {
        statusCode: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': contentType,
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'X-Content-Type-Options': 'nosniff',
          'X-Prescription-Image-Optimization': optimizationStatus,
        },
        body: Buffer.from(transformed).toString('base64'),
        isBase64Encoded: true,
      };
    } catch (error) {
      if (controller.signal.aborted) {
        return buildJsonResponse(
          504,
          { error: 'Tiempo de espera agotado al descargar la imagen de receta.' },
          { requestOrigin }
        );
      }
      console.warn('Prescription image proxy failed', safeErrorLog(error));
      return buildJsonResponse(
        502,
        { error: 'No se pudo optimizar la imagen de receta.' },
        { requestOrigin }
      );
    } finally {
      clearTimeout(timeoutHandle);
    }
  };

export const handler = createPrescriptionImageProxyHandler();
