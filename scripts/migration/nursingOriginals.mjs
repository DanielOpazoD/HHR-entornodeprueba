import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCE = 'hhr-serviciohospitalizados.firebasestorage.app';
const TARGET = 'hhr-pruebas.firebasestorage.app';
const PREFIX = 'entregas-enfermeria/';
const ARCHIVE = PREFIX + 'originales-antiguo/';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validMd5 = value =>
  typeof value === 'string' &&
  /^[A-Za-z0-9+/]{22}==$/.test(value) &&
  Buffer.from(value, 'base64').length === 16;
const usable = item =>
  typeof item?.name === 'string' &&
  item.name.startsWith(PREFIX) &&
  typeof item.generation === 'string' &&
  /^[1-9]\d*$/.test(item.generation) &&
  typeof item.size === 'string' &&
  /^\d+$/.test(item.size);

/** Originals get immutable generation-specific archive keys. Existing current PDFs never change. */
export const planNursingOriginals = ({ sourceBucket, targetBucket, source, target }) => {
  if (
    sourceBucket !== SOURCE ||
    targetBucket !== TARGET ||
    !Array.isArray(source) ||
    !Array.isArray(target)
  )
    throw new Error('unexpected_archive_inventory');
  const destination = new Map();
  for (const item of target) {
    if (!usable(item) || destination.has(item.name))
      throw new Error('invalid_target_object_metadata');
    destination.set(item.name, item);
  }
  const seen = new Set(),
    proposals = [],
    cases = [];
  for (const item of source) {
    if (!usable(item) || seen.has(JSON.stringify([item.name, item.generation])))
      throw new Error('invalid_source_object_metadata');
    seen.add(JSON.stringify([item.name, item.generation]));
    const id = hash([SOURCE, item.name, item.generation]);
    const archiveName = `${ARCHIVE}${id}.pdf`;
    const archived = destination.get(archiveName),
      current = destination.get(item.name);
    let status;
    if (!/\.pdf$/i.test(item.name) || !validMd5(item.md5Hash)) status = 'review_source_metadata';
    else if (archived)
      status =
        validMd5(archived.md5Hash) &&
        item.md5Hash === archived.md5Hash &&
        item.size === archived.size
          ? 'already_archived'
          : 'archive_conflict_review';
    else {
      status = 'archive_candidate';
      proposals.push({
        sourceBucket: SOURCE,
        sourceName: item.name,
        sourceGeneration: item.generation,
        targetBucket: TARGET,
        targetName: archiveName,
        ifSourceGenerationMatch: item.generation,
        ifGenerationMatch: '0',
        expectedMd5: item.md5Hash,
        expectedSize: item.size,
      });
    }
    const sameCurrentPath = !current
      ? 'absent'
      : !validMd5(item.md5Hash) || !validMd5(current.md5Hash)
        ? 'unverified'
        : current.md5Hash === item.md5Hash && current.size === item.size
          ? 'same_content'
          : 'different_content';
    cases.push({ caseId: id, status, sameCurrentPath });
  }
  return {
    proposals,
    report: {
      schemaVersion: 1,
      sourceObjects: source.length,
      targetObjects: target.length,
      cases,
      archiveCandidates: proposals.length,
      cloudWrites: 0,
      authorizesCopy: false,
    },
  };
};

const gcloud = args =>
  execFileSync(process.env.GCLOUD_BIN || 'gcloud', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
  }).trim();
export const collectNursingOriginals = async ({ runGcloud = gcloud, fetchImpl = fetch } = {}) => {
  for (const [id, number] of [
    ['hhr-serviciohospitalizados', '179072085914'],
    ['hhr-pruebas', '339724354374'],
  ]) {
    const project = JSON.parse(
      runGcloud([
        'projects',
        'describe',
        id,
        '--format=json(projectId,projectNumber,lifecycleState)',
      ])
    );
    if (
      project.projectId !== id ||
      String(project.projectNumber) !== number ||
      project.lifecycleState !== 'ACTIVE'
    )
      throw new Error('archive_project_mismatch');
  }
  const headers = { Authorization: `Bearer ${runGcloud(['auth', 'print-access-token'])}` };
  const list = async bucket => {
    const result = [],
      seen = new Set();
    let page = '';
    do {
      const params = new URLSearchParams({
        prefix: PREFIX,
        maxResults: '100',
        fields: 'items(name,generation,md5Hash,size),nextPageToken',
      });
      if (bucket === SOURCE) params.set('versions', 'true');
      if (page) params.set('pageToken', page);
      const response = await fetchImpl(
        `https://storage.googleapis.com/storage/v1/b/${bucket}/o?${params}`,
        { method: 'GET', redirect: 'error', headers, signal: AbortSignal.timeout(30000) }
      );
      if (!response.ok) throw new Error('archive_metadata_read_failed');
      const data = await response.json();
      if (!Array.isArray(data.items || [])) throw new Error('invalid_archive_page');
      result.push(...(data.items || []));
      page = data.nextPageToken || '';
      if (page && (typeof page !== 'string' || seen.has(page) || seen.size >= 100))
        throw new Error('invalid_archive_pagination');
      seen.add(page);
    } while (page);
    return result;
  };
  const source = await list(SOURCE),
    target = await list(TARGET);
  return planNursingOriginals({ sourceBucket: SOURCE, targetBucket: TARGET, source, target });
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) {
    console.error('Solo consulta de metadatos; no existe modo de copia.');
    process.exitCode = 1;
  } else
    collectNursingOriginals()
      .then(({ report }) => console.log(JSON.stringify(report)))
      .catch(() => {
        console.error('Inventario de originales detenido; no se copiaron ni modificaron archivos.');
        process.exitCode = 1;
      });
}
