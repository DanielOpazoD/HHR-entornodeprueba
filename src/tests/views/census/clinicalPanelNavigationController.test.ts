import { describe, expect, it } from 'vitest';

import { resolveClinicalPanelNavigation } from '@/features/census/controllers/clinicalPanelNavigationController';

describe('clinical panel navigation controller', () => {
  it('resolves adjacent patients in the visible census order without wrapping', () => {
    document.body.innerHTML = `
      <button data-clinical-panel-key="R1:101"></button>
      <button data-clinical-panel-key="R2:102"></button>
      <button data-clinical-panel-key="R3:103"></button>
    `;

    const middle = resolveClinicalPanelNavigation(document, 'R2:102');
    expect(middle.previous?.dataset.clinicalPanelKey).toBe('R1:101');
    expect(middle.next?.dataset.clinicalPanelKey).toBe('R3:103');

    const first = resolveClinicalPanelNavigation(document, 'R1:101');
    expect(first.previous).toBeNull();
    expect(first.next?.dataset.clinicalPanelKey).toBe('R2:102');
  });

  it('ignores disabled panel triggers', () => {
    document.body.innerHTML = `
      <button data-clinical-panel-key="R1:101"></button>
      <button data-clinical-panel-key="R2:102" disabled></button>
      <button data-clinical-panel-key="R3:103"></button>
    `;

    expect(resolveClinicalPanelNavigation(document, 'R1:101').next?.dataset.clinicalPanelKey).toBe(
      'R3:103'
    );
  });
});
