import {
  buildCorsHeaders,
  buildJsonResponse,
  getRequestOrigin,
  isOriginAllowed,
  type NetlifyEventLike,
} from './lib/http';

interface TransformOptions {
  width: number;
  quality: number;
}

interface PrescriptionImageProxyDependencies {
  fetch: typeof fetch;
  transformImage: (input: Uint8Array, options: TransformOptions) => Promise<Uint8Array | Buffer>;
}

const MIN_WIDTH = 360;
const MAX_WIDTH = 1200;
const MIN_QUALITY = 40;
const MAX_QUALITY = 80;

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

// Served unchanged only when sharp cannot re-encode them: types a browser never runs as a page.
const PASSTHROUGH_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const decodePathSegment = (value: string | undefined): string => {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
};

const decodeStorageObjectPath = (sourceUrl: URL): string =>
  decodePathSegment(sourceUrl.pathname.match(/\/o\/(.+)$/)?.[1]);

const decodeStorageBucket = (sourceUrl: URL): string =>
  decodePathSegment(sourceUrl.pathname.match(/^\/v0\/b\/([^/]+)\/o\//)?.[1]);

/** HHR's own Storage bucket. Without it configured, no remote source is allowed. */
const resolveAllowedStorageBuckets = (): string[] => {
  const projectId = String(process.env.VITE_FIREBASE_PROJECT_ID || '').trim();
  return [
    String(process.env.VITE_FIREBASE_STORAGE_BUCKET || '').trim(),
    projectId ? `${projectId}.firebasestorage.app` : '',
    projectId ? `${projectId}.appspot.com` : '',
  ].filter(Boolean);
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
  if (!resolveAllowedStorageBuckets().includes(decodeStorageBucket(sourceUrl))) return false;

  return decodeStorageObjectPath(sourceUrl).startsWith('prescriptions/');
};

const mediaTypeOf = (contentType: string): string =>
  contentType.split(';')[0]?.trim().toLowerCase() ?? '';

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
  return sharp(input, { failOn: 'none' })
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
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: '',
      };
    }

    if (event.httpMethod !== 'GET') {
      return buildJsonResponse(405, { error: 'Method not allowed' }, { requestOrigin });
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

    try {
      const upstream = await dependencies.fetch(sourceUrl);
      if (!upstream.ok) {
        return buildJsonResponse(
          502,
          { error: `Image source responded with ${upstream.status}.` },
          { requestOrigin }
        );
      }

      const bytes = new Uint8Array(await upstream.arrayBuffer());
      const upstreamContentType = upstream.headers.get('content-type') || 'image/jpeg';
      let transformed: Uint8Array | Buffer = bytes;
      let contentType = upstreamContentType;
      let optimizationStatus = 'fallback';

      try {
        transformed = await dependencies.transformImage(bytes, { width, quality });
        contentType = 'image/jpeg';
        optimizationStatus = 'optimized';
      } catch (transformError) {
        console.warn('Prescription image optimization fallback', transformError);
        if (!PASSTHROUGH_IMAGE_TYPES.has(mediaTypeOf(upstreamContentType))) {
          return buildJsonResponse(
            415,
            { error: 'Unsupported prescription image type.' },
            { requestOrigin }
          );
        }
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
      console.warn('Prescription image proxy failed', error);
      return buildJsonResponse(
        502,
        { error: 'No se pudo optimizar la imagen de receta.' },
        { requestOrigin }
      );
    }
  };

export const handler = createPrescriptionImageProxyHandler();
