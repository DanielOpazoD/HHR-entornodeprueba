import { describe, expect, it } from 'vitest';

import {
  appendClinicalDocumentPlanSubsectionText,
  appendClinicalDocumentUnifiedPlanText,
  buildStructuredClinicalDocumentPlanSectionContent,
  buildClinicalDocumentPlanSectionContent,
  buildUnifiedClinicalDocumentPlanSectionContent,
  parseClinicalDocumentPlanSectionContent,
  resolveClinicalDocumentPlanSectionLayout,
  updateClinicalDocumentPlanSubsectionContent,
} from '@/features/clinical-documents/controllers/clinicalDocumentPlanSectionController';

describe('clinicalDocumentPlanSectionController', () => {
  it('builds and parses the three plan subsections', () => {
    const content = buildClinicalDocumentPlanSectionContent({
      generales: 'Reposo relativo',
      farmacologicas: 'Paracetamol 1 g cada 8 horas',
      control_clinico: 'Control en 7 dias',
    });

    const parsed = parseClinicalDocumentPlanSectionContent(content);

    expect(parsed.generales).toContain('Reposo relativo');
    expect(parsed.farmacologicas).toContain('Paracetamol');
    expect(parsed.control_clinico).toContain('Control en 7 dias');
  });

  it('preserves legacy free text before recognized plan headings as general indications', () => {
    const parsed = parseClinicalDocumentPlanSectionContent(
      [
        '<div>Reposo relativo previo</div>',
        '<div><strong>Indicaciones farmacológicas</strong></div>',
        '<div>Paracetamol según dolor</div>',
        '<div><strong>Control clínico</strong></div>',
        '<div>Control en policlínico</div>',
      ].join('')
    );

    expect(parsed.generales).toBe('<div>Reposo relativo previo</div>');
    expect(parsed.farmacologicas).toBe('<div>Paracetamol según dolor</div>');
    expect(parsed.control_clinico).toBe('<div>Control en policlínico</div>');
  });

  it('updates and appends only the targeted subsection', () => {
    const updated = updateClinicalDocumentPlanSubsectionContent('', 'farmacologicas', 'Ibuprofeno');
    const appended = appendClinicalDocumentPlanSubsectionText(
      updated,
      'generales',
      'Reposo Absoluto'
    );
    const parsed = parseClinicalDocumentPlanSectionContent(appended);

    expect(parsed.generales).toContain('Reposo Absoluto');
    expect(parsed.farmacologicas).toContain('Ibuprofeno');
    expect(parsed.control_clinico).toBe('');
  });

  it('appends consecutive indication phrases as dash-prefixed lines without blank spacers', () => {
    const once = appendClinicalDocumentPlanSubsectionText('', 'generales', 'Reposo Absoluto');
    const twice = appendClinicalDocumentPlanSubsectionText(once, 'generales', 'Reposo Relativo');
    const parsed = parseClinicalDocumentPlanSectionContent(twice);

    expect(parsed.generales).toBe('<div>- Reposo Absoluto</div><div>- Reposo Relativo</div>');
  });

  it('appends multiline indications to unified plan content as dash-prefixed lines', () => {
    const appended = appendClinicalDocumentUnifiedPlanText(
      '<div>-</div>',
      'Reposo relativo\nControl en policlínico'
    );

    expect(appended).toBe('<div>- Reposo relativo</div><div>- Control en policlínico</div>');
    expect(appended).not.toContain('Indicaciones farmacológicas');
    expect(resolveClinicalDocumentPlanSectionLayout({ content: appended, layout: 'unified' })).toBe(
      'unified'
    );
  });

  it.each([
    '-',
    '<div>-<br></div>',
    '<div>-</div><div><br></div>',
    '<p>-</p>',
    '<ul><li><br></li></ul>',
    '<ul><li></li></ul>',
  ])(
    'replaces an empty dash placeholder before inserting into an empty unified plan: %s',
    placeholderContent => {
      const appended = appendClinicalDocumentUnifiedPlanText(placeholderContent, 'Reposo relativo');

      expect(appended).toBe('<div>- Reposo relativo</div>');
    }
  );

  it('does not duplicate dash prefixes when inserted indications already include them', () => {
    const appended = appendClinicalDocumentUnifiedPlanText('', '- Reposo relativo\n- Control SOS');

    expect(appended).toBe('<div>- Reposo relativo</div><div>- Control SOS</div>');
  });

  it('escapes plain-text indications before appending them to plan content', () => {
    const appended = appendClinicalDocumentUnifiedPlanText(
      '',
      '<img src=x onerror=alert(1)> & control'
    );

    expect(appended).toBe('<div>- &lt;img src=x onerror=alert(1)&gt; &amp; control</div>');
  });

  it('can simplify the structured plan into a unified free-text section', () => {
    const structured = buildClinicalDocumentPlanSectionContent({
      generales: '<div>Reposo relativo</div>',
      farmacologicas: '<div>Paracetamol</div>',
      control_clinico: '<div>Control en 7 días</div>',
    });

    const unified = buildUnifiedClinicalDocumentPlanSectionContent(structured);

    expect(unified).not.toContain('Indicaciones generales');
    expect(unified).toContain('Reposo relativo');
    expect(unified).toContain('Paracetamol');
    expect(unified).toContain('Control en 7 días');
    expect(resolveClinicalDocumentPlanSectionLayout({ content: unified, layout: undefined })).toBe(
      'unified'
    );
  });

  it('can rebuild a unified plan section into the structured template', () => {
    const rebuilt = buildStructuredClinicalDocumentPlanSectionContent(
      '<div>Reposo relativo, analgesia y control en 7 días</div>'
    );

    expect(rebuilt).toContain('Indicaciones generales');
    expect(rebuilt).toContain('Indicaciones farmacológicas');
    expect(rebuilt).toContain('Control clínico');

    const parsed = parseClinicalDocumentPlanSectionContent(rebuilt);
    expect(parsed.generales).toContain('Reposo relativo');
    expect(parsed.farmacologicas).toBe('');
    expect(parsed.control_clinico).toBe('');
  });

  it('defaults an empty plan section to the simplified (unified) layout', () => {
    expect(resolveClinicalDocumentPlanSectionLayout({ content: '', layout: undefined })).toBe(
      'unified'
    );
  });

  it('preserves the structured layout when content already has recognized headings', () => {
    const structured = buildClinicalDocumentPlanSectionContent({
      generales: '<div>Reposo</div>',
      farmacologicas: '',
      control_clinico: '',
    });
    expect(
      resolveClinicalDocumentPlanSectionLayout({ content: structured, layout: undefined })
    ).toBe('structured');
  });

  it('honors an explicit layout override even when content is empty', () => {
    expect(resolveClinicalDocumentPlanSectionLayout({ content: '', layout: 'structured' })).toBe(
      'structured'
    );
  });
});
