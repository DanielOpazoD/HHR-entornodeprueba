const functions = require('firebase-functions/v1');

const RENDER_ALLOWED_ROLES = new Set(['admin', 'doctor_urgency', 'nurse_hospital', 'editor']);
const MAX_HTML_LENGTH = 650_000;
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
  return resolveRoleForEmail(callerEmail);
};

const assertRenderAccess = async (context, resolveRoleForEmail) => {
  if (!context?.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const role = await resolveCallerRole(context, resolveRoleForEmail);
  if (!RENDER_ALLOWED_ROLES.has(role)) {
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

const renderPdfFromHtml = async html => {
  const { chromium, puppeteer } = loadPuppeteerDependencies();
  const executablePath = await chromium.executablePath();
  const headless = 'shell';

  const browser = await puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless }),
    defaultViewport: PDF_BROWSER_VIEWPORT,
    executablePath,
    headless,
  });

  try {
    const page = await browser.newPage();
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
    await browser.close();
  }
};

const createClinicalDocumentPdfRenderFunctions = ({
  resolveRoleForEmail,
  renderPdfFromHtmlOverride,
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
  createClinicalDocumentPdfRenderFunctions,
  resolveChromiumDependency,
};
