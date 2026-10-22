import { describe, expect, it } from 'vitest';

import {
  formatHandoffMessage,
  getDefaultTemplates,
} from '@/services/integrations/whatsapp/whatsappTemplatesStore';

describe('formatHandoffMessage', () => {
  it('replaces all template variables', () => {
    const template =
      'Date: {{date}}, By: {{signedBy}}, At: {{signedAt}}, Hosp: {{hospitalized}}, Free: {{freeBeds}}, New: {{newAdmissions}}, Disc: {{discharges}}, URL: {{handoffUrl}}, Crit: {{criticalPatients}}';

    const result = formatHandoffMessage(template, {
      date: '2026-03-10',
      signedBy: 'Dr. Test',
      signedAt: '14:00',
      hospitalized: 12,
      freeBeds: 5,
      newAdmissions: 2,
      discharges: 1,
      handoffUrl: 'https://app.test/handoff/1',
      criticalPatients: 3,
    });

    expect(result).toContain('2026-03-10');
    expect(result).toContain('Dr. Test');
    expect(result).toContain('14:00');
    expect(result).toContain('12');
    expect(result).toContain('5');
    expect(result).toContain('2');
    expect(result).toContain('1');
    expect(result).toContain('https://app.test/handoff/1');
    expect(result).toContain('3');
  });

  it('defaults criticalPatients to 0 when not provided', () => {
    const template = 'Critical: {{criticalPatients}}';
    const result = formatHandoffMessage(template, {
      date: '',
      signedBy: '',
      signedAt: '',
      hospitalized: 0,
      freeBeds: 0,
      newAdmissions: 0,
      discharges: 0,
      handoffUrl: '',
    });
    expect(result).toBe('Critical: 0');
  });

  it('handles multiple occurrences of the same variable', () => {
    const template = '{{date}} - {{date}}';
    const result = formatHandoffMessage(template, {
      date: '2026-03-10',
      signedBy: '',
      signedAt: '',
      hospitalized: 0,
      freeBeds: 0,
      newAdmissions: 0,
      discharges: 0,
      handoffUrl: '',
    });
    expect(result).toBe('2026-03-10 - 2026-03-10');
  });
});

describe('getDefaultTemplates', () => {
  it('returns at least one default template', () => {
    const defaults = getDefaultTemplates();
    expect(defaults.length).toBeGreaterThanOrEqual(1);
  });

  it('includes a handoff type template', () => {
    const defaults = getDefaultTemplates();
    const handoff = defaults.find(t => t.type === 'handoff');
    expect(handoff).toBeDefined();
    expect(handoff!.content).toContain('{{date}}');
  });
});
