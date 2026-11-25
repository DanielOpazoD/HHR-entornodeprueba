const functions = require('firebase-functions/v1');
const { canRenderClinicalDocumentPdfRole } = require('./auth/rolePredicates');

const MAX_HTML_LENGTH = 650_000;
const IGNORED_OBSERVATION_PROTOCOLS = new Set(['data:', 'blob:', 'about:']);
const MAX_OBSERVED_ORIGIN_ENTRIES = 25;
const PDF_BROWSER_VIEWPORT = {
  deviceScaleFactor: 1,
  hasTouch: false,
  height: 1080,
  isLandscape: true,
  isMobile: false,
  width: 1920,
};

const assertString = (value, fieldName) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Missing required field: ${fieldName}`
    );
  }
  return value;
};

const resolveCallerRole = async (context, resolveRoleForEmail) => {
  const callerEmail = String(context?.auth?.token?.email || '')
    .trim()
    .toLowerCase();
  if (!callerEmail) return 'unauthorized';
  return resolveRoleForEmail(callerEmail, context);
};

const assertRenderAccess = async (context, resolveRoleForEmail) => {
  if (!context?.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const role = await resolveCallerRole(context, resolveRoleForEmail);
  if (!canRenderClinicalDocumentPdfRole(role)) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Insufficient permissions to render clinical documents.'
    );
  }
};

const sanitizeHtmlPayload = html => {
  if (html.length > MAX_HTML_LENGTH) {
    throw new functions.https.HttpsError('invalid-argument', 'HTML payload exceeds max size.');
  }
  if (/<script[\s>]/i.test(html) || /javascript:/i.test(html)) {
    throw new functions.https.HttpsError('invalid-argument', 'Unsupported HTML payload.');
  }
  return html;
};

const resolveChromiumDependency = moduleValue => moduleValue?.default || moduleValue;

/**
 * Classifies an observed Puppeteer request URL to its origin only so logs never
 * contain credentials, Storage object paths (which may carry patient RUTs),
 * query tokens, or fragments.
 */
const classifyObservedRequestOrigin = rawUrl => {
  if (typeof rawUrl !== 'string' || !rawUrl) return null;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return '(unparseable)';
  }
  if (IGNORED_OBSERVATION_PROTOCOLS.has(parsed.protocol)) {
    return null;
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    return parsed.origin;
  }
  return `${parsed.protocol}//(opaque)`;
};

const createExternalRequestObserver = () => {
  /** @type {Map<string, { origin: string; resourceType: string; count: number }>} */
  const observed = new Map();
  let totalCount = 0;
  let truncated = false;

  const onRequest = request => {
    try {
      const rawUrl = typeof request?.url === 'function' ? request.url() : '';
      const origin = classifyObservedRequestOrigin(rawUrl);
      if (!origin) return;
      const resourceType =
        typeof request?.resourceType === 'function'
          ? String(request.resourceType() || 'other')
          : 'other';

      totalCount += 1;
      const key = `${origin}|${resourceType}`;
      const existing = observed.get(key);
      if (existing) {
        existing.count += 1;
      } else if (observed.size < MAX_OBSERVED_ORIGIN_ENTRIES) {
        observed.set(key, { origin, resourceType, count: 1 });
      } else {
        truncated = true;
      }
    } catch {
      // Observation mode is strictly passive and must never interrupt PDF rendering.
    }
  };

  const flush = () => {
    if (totalCount === 0) return;
    console.info('[clinical-pdf-render] observed external page requests', {
      totalCount,
      truncated,
      requests: Array.from(observed.values()),
    });
  };

  return { onRequest, flush };
};

const loadPuppeteerDependencies = () => {
  try {
    const chromiumModule = require('@sparticuz/chromium');
    const chromium = resolveChromiumDependency(chromiumModule);
    const puppeteer = require('puppeteer-core');
    return { chromium, puppeteer };
  } catch (error) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'PDF render dependencies are not installed in functions runtime.'
    );
  }
};

const renderPdfFromHtml = async (html, loadDependencies = loadPuppeteerDependencies) => {
  const { chromium, puppeteer } = loadDependencies();
  const executablePath = await chromium.executablePath();
  const headless = 'shell';

  const browser = await puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless }),
    defaultViewport: PDF_BROWSER_VIEWPORT,
    executablePath,
    headless,
  });

  let detachRequestObserver = () => {};
  const observer = createExternalRequestObserver();

  try {
    const page = await browser.newPage();
    // Clinical document HTML is static print markup; disabling JS blocks event-handler execution
    // (e.g. img onerror/svg onload) inside the headless Chromium instance.
    await page.setJavaScriptEnabled(false);
    // Passive observation mode: record external request origins + resource types (never URLs/tokens)
    // without blocking or intercepting requests so we can validate real production origins safely.
    if (typeof page.on === 'function') {
      page.on('request', observer.onRequest);
      if (typeof page.off === 'function') {
        detachRequestObserver = () => {
          page.off?.('request', observer.onRequest);
        };
      }
    }
    await page.setContent(html, {
      waitUntil: ['domcontentloaded', 'networkidle0'],
      timeout: 30_000,
    });
    const pdfBuffer = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      format: 'letter',
      margin: {
        top: '0mm',
        right: '0mm',
        bottom: '0mm',
        left: '0mm',
      },
    });

    return Buffer.from(pdfBuffer);
  } finally {
    try {
      detachRequestObserver();
    } catch {
      // Ignore listener teardown errors during browser cleanup.
    }
    observer.flush();
    await browser.close();
  }
};

const createClinicalDocumentPdfRenderFunctions = ({
  resolveRoleForEmail,
  renderPdfFromHtmlOverride = undefined,
}) => ({
  renderClinicalDocumentPdfFromHtml: functions
    .runWith({
      memory: '1GB',
      timeoutSeconds: 120,
    })
    .https.onCall(async (data, context) => {
      await assertRenderAccess(context, resolveRoleForEmail);

      const rawHtml = assertString(data?.html, 'html');
      const sanitizedHtml = sanitizeHtmlPayload(rawHtml);
      const pdfBuffer = await (renderPdfFromHtmlOverride || renderPdfFromHtml)(sanitizedHtml);

      return {
        contentBase64: pdfBuffer.toString('base64'),
        mimeType: 'application/pdf',
      };
    }),
});

module.exports = {
  classifyObservedRequestOrigin,
  createClinicalDocumentPdfRenderFunctions,
  renderPdfFromHtml,
  resolveChromiumDependency,
};
