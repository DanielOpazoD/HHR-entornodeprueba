// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import '../../../extension/hhr-center-styles.js';

describe('Centro HHR style owner', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('installs notice styles once with the established scoped host', () => {
    globalThis.HhrCenterStyles.ensureNoticeStyles(document);
    globalThis.HhrCenterStyles.ensureNoticeStyles(document);

    const styles = document.querySelectorAll('#hhr-clinical-page-notice-styles');
    expect(styles).toHaveLength(1);
    expect(styles[0].textContent).toContain('#hhr-clinical-page-notices .hhr-page-notice');
  });

  it('installs center styles once and obtains design tokens from HhrUI', () => {
    const tokenRule = (selector: string) => `${selector} { --hhr-test-token: #15978b; }`;

    globalThis.HhrCenterStyles.ensureCenterStyles(document, { tokenRule });
    globalThis.HhrCenterStyles.ensureCenterStyles(document, { tokenRule });

    const styles = document.querySelectorAll('#hhr-prescription-print-styles');
    expect(styles).toHaveLength(1);
    expect(styles[0].textContent).toContain(
      '#hhr-prescription-print-modal { --hhr-test-token: #15978b; }'
    );
    expect(styles[0].textContent).toContain('#hhr-prescription-print-modal .hhr-center-dialog');
  });
});

declare global {
  var HhrCenterStyles: {
    ensureNoticeStyles: (document: Document) => void;
    ensureCenterStyles: (
      document: Document,
      ui: { tokenRule: (selector: string) => string }
    ) => void;
  };
}
