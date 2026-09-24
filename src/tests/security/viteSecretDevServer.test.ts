// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveConfig } from 'vite';

describe('Vite development server secret boundary', () => {
  it('denies the Functions emulator secret without dropping Vite defaults', async () => {
    const config = await resolveConfig({}, 'serve', 'development');
    const deny = (config as typeof config & { fsDenyGlob: (path: string) => boolean }).fsDenyGlob;

    expect(deny('/workspace/functions/.secret.local')).toBe(true);
    expect(deny('/workspace/.env.local')).toBe(true);
    expect(deny('/workspace/functions/private.pem')).toBe(true);
    expect(deny('/workspace/.git/config')).toBe(true);
  });
});
