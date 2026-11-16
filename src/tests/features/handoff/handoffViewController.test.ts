import { describe, expect, it } from 'vitest';

import {
  resolveHandoffTitle,
  resolveHandoffTableHeaderClass,
  resolveHandoffNovedadesValue,
  shouldShowNightCudyrActions,
  resolveHandoffAuditDescriptor,
  resolveHandoffScreenFrame,
} from '@/features/handoff/controllers/handoffViewController';

// ---------------------------------------------------------------------------
// resolveHandoffTitle
// ---------------------------------------------------------------------------
describe('resolveHandoffTitle', () => {
  it('returns nursing day shift title', () => {
    const title = resolveHandoffTitle('day');
    expect(title).toContain('Enfermería');
    expect(title).toContain('Día');
  });

  it('returns nursing night shift title', () => {
    const title = resolveHandoffTitle('night');
    expect(title).toContain('Enfermería');
    expect(title).toContain('Noche');
  });
});

// ---------------------------------------------------------------------------
// resolveHandoffTableHeaderClass
// ---------------------------------------------------------------------------
describe('resolveHandoffTableHeaderClass', () => {
  it('returns sky-themed class for nursing day shift', () => {
    const cls = resolveHandoffTableHeaderClass('day');
    expect(cls).toContain('bg-medical-50');
    expect(cls).toContain('text-sky-900');
  });

  it('returns slate-themed class for nursing night shift', () => {
    const cls = resolveHandoffTableHeaderClass('night');
    expect(cls).toContain('bg-slate-100');
    expect(cls).toContain('text-slate-500');
  });
});

// ---------------------------------------------------------------------------
// resolveHandoffNovedadesValue
// ---------------------------------------------------------------------------
describe('resolveHandoffNovedadesValue', () => {
  const baseRecord = {
    handoffNovedadesDayShift: 'Day novedades text',
    handoffNovedadesNightShift: 'Night novedades text',
  };

  it('returns day shift novedades for nursing day shift', () => {
    expect(resolveHandoffNovedadesValue({ selectedShift: 'day', record: baseRecord })).toBe(
      'Day novedades text'
    );
  });

  it('returns night shift novedades for nursing night shift', () => {
    expect(resolveHandoffNovedadesValue({ selectedShift: 'night', record: baseRecord })).toBe(
      'Night novedades text'
    );
  });

  it('falls back to day shift novedades when night shift is empty', () => {
    const record = { ...baseRecord, handoffNovedadesNightShift: undefined };
    expect(resolveHandoffNovedadesValue({ selectedShift: 'night', record })).toBe(
      'Day novedades text'
    );
  });

  it('returns empty string when day shift novedades is undefined', () => {
    const record = { ...baseRecord, handoffNovedadesDayShift: undefined };
    expect(resolveHandoffNovedadesValue({ selectedShift: 'day', record })).toBe('');
  });

  it('returns empty string when both nursing shifts are undefined', () => {
    const record = { handoffNovedadesDayShift: undefined, handoffNovedadesNightShift: undefined };
    expect(resolveHandoffNovedadesValue({ selectedShift: 'night', record })).toBe('');
  });
});

// ---------------------------------------------------------------------------
// shouldShowNightCudyrActions
// ---------------------------------------------------------------------------
describe('shouldShowNightCudyrActions', () => {
  it('returns true for the night shift', () => {
    expect(shouldShowNightCudyrActions('night')).toBe(true);
  });

  it('returns false for the day shift', () => {
    expect(shouldShowNightCudyrActions('day')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveHandoffAuditDescriptor
// ---------------------------------------------------------------------------
describe('resolveHandoffAuditDescriptor', () => {
  it('returns the nursing audit action with the shift', () => {
    const result = resolveHandoffAuditDescriptor('night');
    expect(result.action).toBe('VIEW_NURSING_HANDOFF');
    expect(result.details.view).toBe('nursing_handoff');
    expect(result.details.shift).toBe('night');
  });
});

// ---------------------------------------------------------------------------
// resolveHandoffScreenFrame
// ---------------------------------------------------------------------------
describe('resolveHandoffScreenFrame', () => {
  it('returns correct frame for nursing night shift', () => {
    const frame = resolveHandoffScreenFrame({ selectedShift: 'night', readOnly: false });
    expect(frame.title).toContain('Noche');
    expect(frame.tableHeaderClass).toContain('bg-slate-100');
  });

  it('respects readOnly flag', () => {
    const frame = resolveHandoffScreenFrame({ selectedShift: 'day', readOnly: true });
    expect(frame.effectiveReadOnly).toBe(true);
  });
});
