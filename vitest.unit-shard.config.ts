import { defineConfig } from 'vitest/config';
import base from './vitest.config';

const files: unknown = JSON.parse(process.env.HHR_UNIT_SHARD_FILES || 'null');
if (
  !Array.isArray(files) ||
  files.length === 0 ||
  !files.every(
    file =>
      typeof file === 'string' &&
      /^src\/tests\/[\w./-]+\.(test|spec)\.[jt]sx?$/.test(file) &&
      !file.split('/').includes('..')
  )
) {
  throw new Error('Unit shards require a nonempty list of exact test paths.');
}

// CLI file filters are substring matches. Replacing include preserves case and
// extension boundaries, so a .test.ts filter cannot also select .test.tsx.
export default defineConfig({ ...base, test: { ...base.test, include: files } });
