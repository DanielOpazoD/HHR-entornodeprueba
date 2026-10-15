import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  buildMigrationInventory,
  INVENTORY_FIELDS,
  SOURCE_PROJECT,
  TARGET_PROJECT,
  PROTECTED_MONTHS,
} from './inventoryCore.mjs';

const expected = { [SOURCE_PROJECT]: '179072085914', [TARGET_PROJECT]: '339724354374' };
const base = project =>
  `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/hospitals/hanga_roa/`;
const gcloud = args =>
  execFileSync(process.env.GCLOUD_BIN || 'gcloud', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
  }).trim();

/** No caller-supplied endpoints, redirects, request bodies or mutation methods. */
export const makeInventoryReader = (token, fetchImpl = fetch) => {
  if (typeof token !== 'string' || !token || /\s/.test(token))
    throw new Error('inventory_credentials_unavailable');
  return async url => {
    if (!Object.keys(expected).some(project => url.startsWith(base(project))))
      throw new Error('inventory_endpoint_not_allowed');
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error('inventory_read_failed');
    return response.json();
  };
};

const listCensus = async (read, project, versionOnly = false) => {
  const documents = [],
    seen = new Set();
  let page = '';
  do {
    const params = new URLSearchParams({ pageSize: '100' });
    for (const field of versionOnly ? ['date'] : INVENTORY_FIELDS)
      params.append('mask.fieldPaths', field);
    if (page) params.set('pageToken', page);
    const result = await read(base(project) + 'dailyRecords?' + params);
    if (!Array.isArray(result.documents || [])) throw new Error('invalid_inventory_page');
    documents.push(...(result.documents || []));
    page = result.nextPageToken || '';
    if (page && (typeof page !== 'string' || seen.has(page) || seen.size >= 100))
      throw new Error('invalid_inventory_pagination');
    seen.add(page);
  } while (page);
  return documents;
};

const officialVersions = async read => {
  const result = {};
  for (const month of PROTECTED_MONTHS) {
    const params = new URLSearchParams();
    for (const field of ['month', 'version']) params.append('mask.fieldPaths', field);
    const document = await read(base(TARGET_PROJECT) + `cudyrOfficialReports/${month}?` + params);
    if (
      !document.updateTime ||
      !document.fields?.version?.stringValue ||
      document.fields?.month?.stringValue !== month
    )
      throw new Error('protected_cudyr_metadata_unavailable');
    result[month] = {
      updateTime: document.updateTime,
      version: document.fields.version.stringValue,
    };
  }
  return result;
};

export const collectMigrationInventory = async ({
  runGcloud = gcloud,
  fetchImpl = fetch,
  observedAt = new Date().toISOString(),
} = {}) => {
  for (const project of Object.keys(expected)) {
    const metadata = JSON.parse(
      runGcloud([
        'projects',
        'describe',
        project,
        '--format=json(projectId,projectNumber,lifecycleState)',
      ])
    );
    if (
      metadata.projectId !== project ||
      String(metadata.projectNumber) !== expected[project] ||
      metadata.lifecycleState !== 'ACTIVE'
    )
      throw new Error('migration_project_identity_mismatch');
  }
  const read = makeInventoryReader(runGcloud(['auth', 'print-access-token']), fetchImpl);
  const officialBefore = await officialVersions(read);
  const [source, target] = await Promise.all([
    listCensus(read, SOURCE_PROJECT),
    listCensus(read, TARGET_PROJECT),
  ]);
  const [sourceAfter, targetAfter] = await Promise.all([
    listCensus(read, SOURCE_PROJECT, true),
    listCensus(read, TARGET_PROJECT, true),
  ]);
  const officialAfter = await officialVersions(read);
  return buildMigrationInventory({
    source,
    target,
    sourceAfter,
    targetAfter,
    officialBefore,
    officialAfter,
    observedAt,
  });
};

export const runInventoryCli = async args => {
  const { values } = parseArgs({
    args,
    options: { out: { type: 'string' }, help: { type: 'boolean' } },
  });
  if (values.help) {
    console.log(
      'node scripts/migration/readInventory.mjs [--out nuevo-informe.json]\nSolo lectura. GCLOUD_BIN permite indicar la ruta de gcloud. No existe --apply.'
    );
    return 0;
  }
  const report = await collectMigrationInventory();
  if (values.out) {
    const destination = resolve(values.out);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    writeFileSync(destination, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  console.log(
    JSON.stringify({
      sourceDays: report.sourceDays,
      targetDays: report.targetDays,
      checks: report.checks,
      canUseForPlanning: report.canUseForPlanning,
      authorizesMigration: false,
    })
  );
  return report.canUseForPlanning ? 0 : 2;
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runInventoryCli(process.argv.slice(2))
    .then(code => {
      process.exitCode = code;
    })
    .catch(() => {
      console.error(
        'Inventario detenido; no se modificaron datos. Revise acceso, configuración o consistencia.'
      );
      process.exitCode = 1;
    });
}
