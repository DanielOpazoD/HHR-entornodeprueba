// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { chunkForModule } from '../../../scripts/config/chunkingPolicy';

describe('React context chunk ownership', () => {
  it('keeps the error-boundary context with the shared React runtime', () => {
    expect(
      chunkForModule('/repo/node_modules/react-error-boundary/dist/react-error-boundary.js')
    ).toBe('vendor-react');
  });
});
