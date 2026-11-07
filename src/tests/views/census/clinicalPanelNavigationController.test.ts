import { describe, expect, it } from 'vitest';

import { resolveClinicalPanelNavigation } from '@/features/census/controllers/clinicalPanelNavigationController';

describe('clinical panel navigation controller', () => {
  it('resolves adjacent patients in the visible census order without wrapping', () => {
    document.body.innerHTML = `
      <span data-clinical-panel-key="R1:101"></span>
      <span data-clinical-panel-key="R2:102"></span>
      <button data-clinical-panel-key="R2:crib"></button>
      <span data-clinical-panel-key="R3:103"></span>
    `;

    expect(resolveClinicalPanelNavigation(document, 'R2:102')).toEqual({
      previous: 'R1:101',
      next: 'R2:crib',
    });
    expect(resolveClinicalPanelNavigation(document, 'R1:101')).toEqual({
      previous: null,
      next: 'R2:102',
    });
    expect(resolveClinicalPanelNavigation(document, 'R3:103').next).toBeNull();
  });

  it('ignores disabled panel triggers and hidden entries', () => {
    document.body.innerHTML = `
      <span data-clinical-panel-key="R1:101"></span>
      <button data-clinical-panel-key="R2:102" disabled></button>
      <span data-clinical-panel-key="R3:103" hidden></span>
      <span data-clinical-panel-key="R4:104"></span>
    `;

    expect(resolveClinicalPanelNavigation(document, 'R1:101').next).toBe('R4:104');
  });
});
