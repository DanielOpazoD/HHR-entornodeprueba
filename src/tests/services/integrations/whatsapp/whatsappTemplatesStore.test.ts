import { describe, expect, it } from 'vitest';

import { getDefaultTemplates } from '@/features/whatsapp/services/whatsappTemplatesStore';

describe('getDefaultTemplates', () => {
  it('returns at least one default template', () => {
    const defaults = getDefaultTemplates();
    expect(defaults.length).toBeGreaterThanOrEqual(1);
  });

  it('no longer offers the retired medical handoff template', () => {
    const defaults = getDefaultTemplates();
    expect(defaults.map(t => t.id)).not.toContain('handoff-default');
    expect(defaults.some(t => t.content.includes('Entrega de Turno Médico'))).toBe(false);
  });

  it('includes a handoff type template', () => {
    const defaults = getDefaultTemplates();
    const handoff = defaults.find(t => t.type === 'handoff');
    expect(handoff).toBeDefined();
    expect(handoff!.content).toContain('{{date}}');
  });
});
