// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  collectNursingOriginals,
  planNursingOriginals,
} from '../../../scripts/migration/nursingOriginals.mjs';

const sourceBucket = 'hhr-serviciohospitalizados.firebasestorage.app',
  targetBucket = 'hhr-pruebas.firebasestorage.app';
const md5 = Buffer.alloc(16, 1).toString('base64');
const object = (extra = {}) => ({
  name: 'entregas-enfermeria/PRIVATE_NAME.pdf',
  generation: '10',
  size: '123',
  md5Hash: md5,
  ...extra,
});
const input = () => ({
  sourceBucket,
  targetBucket,
  source: [object()],
  target: [object({ md5Hash: Buffer.alloc(16, 2).toString('base64') })],
});

describe('preservation of original nursing PDFs', () => {
  it('archives a different same-path file separately without overwriting current PDFs', () => {
    const data = input(),
      before = structuredClone(data),
      result = planNursingOriginals(data);
    expect(result.report.cases[0]).toMatchObject({
      status: 'archive_candidate',
      sameCurrentPath: 'different_content',
    });
    expect(result.proposals[0]).toMatchObject({
      ifSourceGenerationMatch: '10',
      ifGenerationMatch: '0',
      expectedMd5: md5,
    });
    expect(result.proposals[0].targetName).not.toBe(data.source[0].name);
    expect(JSON.stringify(result.report)).not.toContain('PRIVATE_NAME');
    expect(data).toEqual(before);
    expect(result.report.cloudWrites).toBe(0);
    expect(result.report.authorizesCopy).toBe(false);
  });
  it('uses a new archive key for a later source generation', () => {
    const data = input(),
      first = planNursingOriginals(data).proposals[0].targetName;
    data.source[0].generation = '11';
    expect(planNursingOriginals(data).proposals[0].targetName).not.toBe(first);
  });
  it('preserves multiple generations of the same source object', () => {
    const data = input();
    data.source.push(object({ generation: '11' }));
    const result = planNursingOriginals(data);
    expect(result.proposals).toHaveLength(2);
    expect(new Set(result.proposals.map(item => item.targetName)).size).toBe(2);
    data.source.push(object({ generation: '11' }));
    expect(() => planNursingOriginals(data)).toThrow('invalid_source_object_metadata');
  });
  it('is idempotent when the exact archived version is present', () => {
    const data = input();
    const proposal = planNursingOriginals(data).proposals[0];
    data.target.push(object({ name: proposal.targetName }));
    expect(planNursingOriginals(data).report.cases[0].status).toBe('already_archived');
    expect(planNursingOriginals(data).proposals).toEqual([]);
  });
  it('holds an occupied archive key with different content, missing checksum or size mismatch', () => {
    const data = input();
    const proposal = planNursingOriginals(data).proposals[0];
    for (const extra of [
      { md5Hash: '' },
      { md5Hash: Buffer.alloc(16, 3).toString('base64') },
      { size: '124' },
    ]) {
      data.target = [object({ name: proposal.targetName, ...extra })];
      expect(planNursingOriginals(data).report.cases[0].status).toBe('archive_conflict_review');
      expect(planNursingOriginals(data).proposals).toEqual([]);
    }
  });
  it('never deduplicates by filename or size alone', () => {
    const data = input();
    data.source[0].md5Hash = '';
    expect(planNursingOriginals(data).report.cases[0]).toMatchObject({
      status: 'review_source_metadata',
      sameCurrentPath: 'unverified',
    });
    expect(planNursingOriginals(data).proposals).toEqual([]);
  });
  it('rejects foreign buckets, outside-prefix objects and duplicate target keys', () => {
    const data = input();
    expect(() => planNursingOriginals({ ...data, sourceBucket: 'other' })).toThrow();
    expect(() =>
      planNursingOriginals({ ...data, source: [object({ name: 'other/file.pdf' })] })
    ).toThrow();
    expect(() => planNursingOriginals({ ...data, target: [object(), object()] })).toThrow();
  });
  it('fetches metadata only with GET and refuses a project mismatch before obtaining credentials', async () => {
    const cloud = vi.fn(() => JSON.stringify({ projectId: 'wrong' })),
      fetcher = vi.fn();
    await expect(
      collectNursingOriginals({ runGcloud: cloud, fetchImpl: fetcher })
    ).rejects.toThrow();
    expect(cloud).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('collects paginated metadata without media reads or writes', async () => {
    const cloud = (args: string[]) =>
      args[0] === 'auth'
        ? 'test-token-placeholder'
        : JSON.stringify({
            projectId: args[2],
            projectNumber: args[2] === 'hhr-pruebas' ? '339724354374' : '179072085914',
            lifecycleState: 'ACTIVE',
          });
    const fetcher = vi.fn<typeof fetch>(async input =>
      Response.json(String(input).includes(sourceBucket) ? { items: [object()] } : { items: [] })
    );
    const result = await collectNursingOriginals({ runGcloud: cloud, fetchImpl: fetcher });
    expect(result.report.archiveCandidates).toBe(1);
    for (const [url, options] of fetcher.mock.calls) {
      expect(String(url)).not.toContain('alt=media');
      expect(new URL(String(url)).searchParams.get('versions')).toBe(
        String(url).includes(sourceBucket) ? 'true' : null
      );
      expect(options).toMatchObject({ method: 'GET', redirect: 'error' });
      expect(new URL(String(url)).searchParams.get('fields')).toBe(
        'items(name,generation,md5Hash,size),nextPageToken'
      );
    }
  });
});
