import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

// Isolated Chromium and synthetic credentials only. The fixture worker composes the shipping
// auth modules with a synthetic API, so no real login or clinical backend can be contacted.
const root = process.cwd();
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hhr-urgency-login-smoke-'));
const extension = path.join(temporary, 'extension');
await fs.mkdir(extension);
const files = [
  'message-contract.js',
  'hhr-origin-policy.js',
  'urgency-api.js',
  'urgency-auth-model.js',
  'urgency-auth-state.js',
  'urgency-auth-runtime.js',
  'urgency-dau-api.js',
  'hospitalization-reports-runtime.js',
  'urgency-login.html',
  'urgency-login.js',
  'urgency-login.css',
];
await Promise.all(
  files.map(file => fs.copyFile(path.join(root, 'extension', file), path.join(extension, file)))
);
const productionManifest = JSON.parse(
  await fs.readFile(path.join(root, 'extension/manifest.json'), 'utf8')
);
await fs.writeFile(
  path.join(extension, 'manifest.json'),
  JSON.stringify({
    manifest_version: 3,
    name: 'Synthetic DAU login verification',
    version: productionManifest.version,
    permissions: ['storage', 'tabs'],
    host_permissions: ['http://localhost:3001/*'],
    background: { service_worker: 'fixture-worker.js' },
    web_accessible_resources: [
      {
        resources: ['urgency-login.html', 'urgency-login.css'],
        matches: ['http://localhost:3001/*'],
      },
    ],
  })
);
await fs.writeFile(
  path.join(extension, 'fixture-worker.js'),
  `
importScripts(${files
    .filter(file => file.endsWith('.js') && file !== 'urgency-login.js')
    .map(file => JSON.stringify(file))
    .join(',')});
globalThis.syntheticRequests = [];
const profile = {Id:3,Permissions:['read'],StaffMember:{Id:6,IdHealthCareCenter:9}};
const users = [{Profile:profile,HealthCareCenter:'Hospital sintético',HealthPractitionerTypes:[{Id:2,Name:'Médico'}]}];
const fetchImpl = async (input, options) => {
  const url = new URL(input), body = options?.body ? JSON.parse(options.body) : null;
  syntheticRequests.push({path:url.pathname,query:Object.fromEntries(url.searchParams),body,credentials:options.credentials});
  const json = value => new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
  if(url.pathname==='/api/usuario/login') return json({ContextId:'synthetic-native-context',StatusMFA:99999,Usuarios:users});
  if(url.pathname==='/api/emergencyAccess/Validate') return json([{Valido:body.Codigo==='123456',Usuarios:users}]);
  if(url.pathname==='/api/tokenAcceso/') {
    if(body.contextId!=='synthetic-native-context') throw Error('Wrong synthetic context');
    return json({EncodedToken:'fake',Profile:profile});
  }
  if(url.pathname==='/api/emergencyAdmissionsByPatient/') return json([{Id:7,IdFacility:9,Patient:{Id:42,Rut:'11.111.111-1'},PatientCare:{Id:8}}]);
  if(url.pathname.includes('/encounters/')) return json({Id:8,IdPatient:42,IdEmergencyAdmission:7,IdHealthCareCenter:9,IsEmergency:true});
  if(url.pathname==='/api/reportes/DAU_C.pdf') return new Response('%PDF-1.7 synthetic report',{headers:{'content-type':'application/pdf'}});
  throw Error('Unexpected synthetic API route');
};
globalThis.syntheticAuth=HhrUrgencyAuth.register({chrome,fetchImpl,getAuthorizationKey:async()=> 'synthetic-owner',normalizeRun:HhrHospitalizationReportsRuntime.normalizeRun});
`
);
const headers = await fs.readFile(path.join(root, 'netlify.toml'), 'utf8');
const policies = [...headers.matchAll(/Content-Security-Policy = "([^"]+)"/g)].map(
  match => match[1]
);
const policy = policies.find(
  value =>
    value.includes('https://securetoken.googleapis.com') &&
    !value.includes('https://cdn.jsdelivr.net')
);
assert.ok(policy, 'Production application CSP was not found');
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  await context.route('http://localhost:3001/**', route =>
    route.fulfill({
      contentType: 'text/html',
      headers: { 'content-security-policy': policy },
      body: '<!doctype html><html lang="es"><head><title>DAU sintético</title></head><body><h1>Atención de prueba · DAU</h1><div id="login"></div></body></html>',
    })
  );
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const page = await context.newPage();
  await page.goto('http://localhost:3001/census');
  const flow = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'http://localhost:3001/*' });
    return (await syntheticAuth.begin({ id: chrome.runtime.id, tab, url: tab.url })).auth;
  });
  await page.evaluate(auth => {
    window.syntheticLoginEvents = [];
    window.addEventListener('message', event =>
      window.syntheticLoginEvents.push({ origin: event.origin, data: event.data })
    );
    const iframe = document.createElement('iframe');
    iframe.src = auth.url;
    iframe.title = 'Acceso seguro a Rayen Urgencias';
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin');
    iframe.referrerPolicy = 'no-referrer';
    iframe.style.width = '380px';
    iframe.style.height = '360px';
    document.getElementById('login').append(iframe);
  }, flow);
  const frame = page.frameLocator('iframe');
  await frame.getByLabel('Usuario', { exact: true }).fill('synthetic.user');
  await frame.getByLabel('Contraseña', { exact: true }).fill('example');
  await frame.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await frame.getByLabel('Código de verificación', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await frame.getByLabel('Contraseña', { exact: true }).inputValue(), '');
  await frame.getByLabel('Código de verificación', { exact: true }).fill('123456');
  await frame.getByRole('button', { name: 'Verificar código', exact: true }).click();
  await page.waitForFunction(() =>
    window.syntheticLoginEvents.some(event => event.data.state === 'authenticated')
  );
  const events = await page.evaluate(() => window.syntheticLoginEvents);
  assert.ok(
    events.some(
      event =>
        event.origin === new URL(flow.url).origin ||
        event.origin === `chrome-extension://${new URL(flow.url).host}`
    )
  );
  assert.equal(JSON.stringify(events).includes('example'), false);
  const result = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'http://localhost:3001/*' });
    const session = await syntheticAuth.sessionFor({ tab, url: tab.url });
    if (!session) throw Error('Synthetic native session missing');
    const pdf = await syntheticAuth.readDau({
      patientRun: '111111111',
      attentionId: '8',
      session,
      assertCurrent: session.assertCurrent,
    });
    return {
      pdfMagic: new TextDecoder().decode(pdf.subarray(0, 5)),
      requests: syntheticRequests,
      store: await chrome.storage.session.get(null),
    };
  });
  assert.equal(result.pdfMagic, '%PDF-');
  assert.deepEqual(result.requests.find(request => request.path.endsWith('DAU_C.pdf')).query, {
    timeDifference: '0',
    nodId: '9',
    iurgId: '7',
    atenId: '8',
    uspId: '42',
  });
  assert.equal(JSON.stringify(result.store).includes('example'), false);
  assert.equal(JSON.stringify(result.store).includes('synthetic-native-context'), false);
  assert.ok(result.requests.every(request => request.credentials === 'omit'));
  console.log(
    JSON.stringify({
      inlineExtensionFrameLoadedUnderProductionCsp: true,
      otpCompleted: true,
      credentialsAbsentFromParentMessages: true,
      passwordAbsentFromSessionStorage: true,
      exactSelectedDauParametersVerified: true,
      realNetworkLoginsPerformed: false,
    })
  );
} finally {
  await context.close();
  await fs.rm(temporary, { recursive: true, force: true });
}
