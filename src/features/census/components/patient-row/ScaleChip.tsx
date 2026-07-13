/**
 * ScaleChip — the census "Scores" chip with a per-scale visual identity (rediseño censo 2026).
 *
 * Anatomy: ONE segmented bar, three zones separated by hairline dividers, so each piece of
 * information owns its own space instead of competing inside a single colored pill:
 *   [ identidad ]  — icon + scale name, tinted with the SCALE's own hue (Braden violet, Downton
 *                    indigo, CUDYR teal). The hue never changes with the result: it identifies.
 *   [ valor ]      — the score, tinted by SEVERITY (emerald/amber/red — clinical semantics).
 *   [ reaplicar ]  — the reapplication countdown, visually separate; neutral until due/overdue,
 *                    then red with the alarm icon.
 *
 * Hovering the chip shows a "sticky note" (portal-positioned, so the table can't clip it) with the
 * date/time it was applied and by whom — data synced from Ficha Médico.
 */

import React, { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { AlarmClock, type LucideIcon } from 'lucide-react';
import type { BradenRiskLevel } from '@/types/domain/evaluationScores';

/**
 * Scale identity hue — fixed per scale, independent of the clinical result. It ONLY tints the small
 * icon: identity is carried by the icon + name (neutral), never by a colored fill, so the only
 * saturated color in the chip is the clinical one (severity on the value, red on an overdue
 * countdown). Restraint is what makes the abnormal value read at a glance.
 */
export type ScaleHue = 'violet' | 'indigo' | 'teal';

const HUE_ICON: Record<ScaleHue, string> = {
  violet: 'text-violet-500',
  indigo: 'text-indigo-500',
  teal: 'text-teal-600',
};

/** Severity tint for the value text (semantic, shared with vitals + the rest of the app). */
const SEVERITY_TEXT: Record<BradenRiskLevel, string> = {
  bajo: 'text-emerald-600',
  medio: 'text-amber-600',
  alto: 'text-red-600',
};

/** CUDYR band tint (A highest acuity → D lowest), matching the CUDYR night-handoff view. */
const BAND_TEXT: Record<'A' | 'B' | 'C' | 'D', string> = {
  A: 'text-rose-600',
  B: 'text-amber-600',
  C: 'text-sky-600',
  D: 'text-emerald-600',
};

const NEUTRAL_TEXT = 'text-slate-600';

export interface StickyNoteData {
  /** Instrument display name, e.g. "Escala de riesgo UPP (Braden)". */
  title: string;
  /** ISO day it was applied (YYYY-MM-DD) — rendered as DD-MM-YYYY. */
  recordedDate: string;
  /** Raw recorded-at string; the HH:MM inside it is extracted for display. */
  recordedAt?: string;
  /** Professional who applied it (absent on data synced before this field existed). */
  author?: string;
  authorRole?: string;
  /** Extra line, e.g. severity label or CUDYR provenance. */
  detail?: string;
}

export interface ScaleChipProps {
  hue: ScaleHue;
  icon: LucideIcon;
  /** Short identity label, e.g. "Braden". */
  label: string;
  /** The score value shown in the value zone, e.g. "16" or "D3". */
  value: string;
  /** Severity level driving the value tint; null → neutral. */
  severity?: BradenRiskLevel | null;
  /** CUDYR band driving the value tint (used instead of severity for CUDYR). */
  band?: 'A' | 'B' | 'C' | 'D' | null;
  /** Reapplication countdown, e.g. "5d" | "hoy" | "-2d"; omitted → no third zone. */
  countdown?: string | null;
  /** True when the scale is due/overdue — countdown zone turns red and alarms. */
  countdownUrgent?: boolean;
  note: StickyNoteData;
}

const formatDayLong = (isoDay: string): string => {
  const match = (isoDay ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : isoDay;
};

const extractTime = (raw?: string): string | null => {
  const match = (raw ?? '').match(/(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null;
};

/** The hover "sticky note": amber paper, slight tilt, portal-fixed above the chip. */
const StickyNote: React.FC<{ note: StickyNoteData; anchor: DOMRect }> = ({ note, anchor }) => {
  const time = extractTime(note.recordedAt);
  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[9999] -translate-x-1/2 -translate-y-full"
      style={{ left: anchor.left + anchor.width / 2, top: anchor.top - 6 }}
    >
      <div className="relative w-max max-w-[220px] -rotate-1 rounded-sm bg-amber-100 px-3 pb-2 pt-3 text-left shadow-lg ring-1 ring-amber-200/80">
        {/* the "tape" holding the note */}
        <span className="absolute -top-1.5 left-1/2 h-2.5 w-8 -translate-x-1/2 rotate-1 rounded-[1px] bg-amber-200/70 shadow-sm" />
        <p className="text-[10px] font-bold leading-snug text-amber-900">{note.title}</p>
        <p className="mt-0.5 text-[10px] tabular-nums text-amber-800">
          {formatDayLong(note.recordedDate)}
          {time && <span> · {time} h</span>}
        </p>
        {note.detail && <p className="text-[10px] italic text-amber-800/90">{note.detail}</p>}
        <p className="mt-1 border-t border-amber-200/80 pt-1 text-[10px] leading-snug text-amber-900">
          {note.author ? (
            <>
              <span className="font-semibold">{note.author}</span>
              {note.authorRole && <span className="text-amber-800/80"> · {note.authorRole}</span>}
            </>
          ) : (
            <span className="italic text-amber-800/70">Profesional no registrado</span>
          )}
        </p>
      </div>
    </div>,
    document.body
  );
};

export const ScaleChip: React.FC<ScaleChipProps> = ({
  hue,
  icon: Icon,
  label,
  value,
  severity = null,
  band = null,
  countdown = null,
  countdownUrgent = false,
  note,
}) => {
  const chipRef = useRef<HTMLSpanElement | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  const show = useCallback(() => {
    if (chipRef.current) setAnchor(chipRef.current.getBoundingClientRect());
  }, []);
  const hide = useCallback(() => setAnchor(null), []);

  const valueTone = band ? BAND_TEXT[band] : severity ? SEVERITY_TEXT[severity] : NEUTRAL_TEXT;

  return (
    <span
      ref={chipRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      className={clsx(
        'flex w-full items-stretch overflow-hidden rounded-md border bg-white text-[10px] leading-tight',
        countdownUrgent ? 'border-red-300 bg-red-50/40' : 'border-slate-200'
      )}
    >
      {/* identity zone — icon in the scale's hue, name neutral; no fill competes with the value */}
      <span className="flex shrink-0 items-center gap-1 px-1.5 py-0.5 font-semibold text-slate-600">
        <Icon size={10} strokeWidth={2.5} className={HUE_ICON[hue]} aria-hidden />
        {label}
      </span>
      {/* value zone — the only place the clinical (severity) color lives */}
      <span
        className={clsx(
          'flex min-w-[18px] flex-1 items-center justify-center border-l border-slate-200 px-1 py-0.5 font-semibold tabular-nums',
          valueTone
        )}
      >
        {value}
      </span>
      {/* reapplication zone — separated in its own space; neutral until it comes due */}
      {countdown != null && (
        <span
          className={clsx(
            'flex shrink-0 items-center gap-0.5 border-l px-1 py-0.5 font-medium tabular-nums',
            countdownUrgent
              ? 'border-red-200 bg-red-50 text-red-600'
              : 'border-slate-200 text-slate-400'
          )}
          title="Próxima aplicación"
        >
          <AlarmClock
            size={9}
            strokeWidth={2.5}
            className={clsx(countdownUrgent && 'animate-pulse motion-reduce:animate-none')}
            aria-hidden
          />
          {countdown}
        </span>
      )}
      {anchor && <StickyNote note={note} anchor={anchor} />}
    </span>
  );
};
