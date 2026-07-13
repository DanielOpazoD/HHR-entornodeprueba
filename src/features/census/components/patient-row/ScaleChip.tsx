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

/** Scale identity hue — fixed per scale, independent of the clinical result. */
export type ScaleHue = 'violet' | 'indigo' | 'teal';

const HUE_SEGMENT: Record<ScaleHue, string> = {
  violet: 'bg-violet-50 text-violet-700',
  indigo: 'bg-indigo-50 text-indigo-700',
  teal: 'bg-teal-50 text-teal-700',
};

/** Severity tint for the value zone (semantic, shared with the rest of the app). */
const SEVERITY_SEGMENT: Record<BradenRiskLevel, string> = {
  bajo: 'bg-emerald-50 text-emerald-700',
  medio: 'bg-amber-50 text-amber-700',
  alto: 'bg-red-50 text-red-700',
};

/** CUDYR band tint (A highest acuity → D lowest), matching the CUDYR night-handoff view. */
const BAND_SEGMENT: Record<'A' | 'B' | 'C' | 'D', string> = {
  A: 'bg-rose-50 text-rose-700',
  B: 'bg-amber-50 text-amber-700',
  C: 'bg-sky-50 text-sky-700',
  D: 'bg-emerald-50 text-emerald-700',
};

const NEUTRAL_SEGMENT = 'bg-slate-50 text-slate-500';

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

  const valueTone = band
    ? BAND_SEGMENT[band]
    : severity
      ? SEVERITY_SEGMENT[severity]
      : NEUTRAL_SEGMENT;

  return (
    <span
      ref={chipRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      className={clsx(
        'flex w-full items-stretch overflow-hidden rounded-md border bg-white text-[9px] leading-tight shadow-[0_1px_1px_rgba(15,23,42,0.05)]',
        countdownUrgent ? 'border-red-300 ring-1 ring-red-300' : 'border-slate-200'
      )}
    >
      {/* identity zone — the scale's own hue, never the result's */}
      <span
        className={clsx(
          'flex shrink-0 items-center gap-0.5 px-1 py-px font-bold uppercase tracking-wide',
          HUE_SEGMENT[hue]
        )}
      >
        <Icon size={9} strokeWidth={2.5} aria-hidden />
        {label}
      </span>
      {/* value zone — severity semantics */}
      <span
        className={clsx(
          'flex min-w-[18px] flex-1 items-center justify-center border-l border-slate-200/70 px-1 py-px font-extrabold tabular-nums',
          valueTone
        )}
      >
        {value}
      </span>
      {/* reapplication zone — its own space, separated from the score */}
      {countdown != null && (
        <span
          className={clsx(
            'flex shrink-0 items-center gap-0.5 border-l px-1 py-px font-bold tabular-nums',
            countdownUrgent
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-slate-200/70 bg-slate-50 text-slate-500'
          )}
          title="Próxima aplicación"
        >
          <AlarmClock
            size={9}
            strokeWidth={2.75}
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
