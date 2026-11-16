// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const BASE_MODAL_PATH = 'src/components/shared/BaseModal.tsx';

describe('BaseModal entrypoint governance', () => {
  it('keeps BaseModal as a public entrypoint over focused internals', () => {
    const content = readFileSync(BASE_MODAL_PATH, 'utf8');

    expect(content).not.toMatch(/export interface\s+BaseModalProps/);
    expect(content).not.toMatch(/createPortal/);
    expect(content).toMatch(/from ['"]@\/components\/shared\/baseModalContracts['"]/);
    expect(content).toMatch(/from ['"]@\/components\/shared\/baseModalContent['"]/);
  });
});
