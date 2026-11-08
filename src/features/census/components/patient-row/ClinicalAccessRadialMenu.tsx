/**
 * The ring that opens from a row's «Accesos» button: the four clinical topics around the
 * explorer disc. It floats over the census and closes on Escape, an outside click, a scroll or a
 * resize, handing focus back to the button before any topic opens.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { ClipboardList, FileText, FlaskConical, ScanLine, type LucideIcon } from 'lucide-react';

import {
  RADIAL_ARROW_SECTORS,
  RADIAL_BADGE_RADIUS,
  RADIAL_CORE_RADIUS,
  RADIAL_DIVIDERS,
  RADIAL_ICON_RADIUS,
  RADIAL_OUTER_RADIUS,
  RADIAL_VIEW_RADIUS,
  radialAccentPath,
  radialLabelPath,
  radialPoint,
  radialSectorMiddle,
  radialSectorPath,
  resolveRadialCenter,
  type ClinicalAccessSector,
} from './clinicalAccessRadialGeometry';
import { CLINICAL_ACCESS_MANUTARA_SRC } from './patientClinicalAccessIcons';
import './clinicalAccessRadial.css';

export interface ClinicalAccessRadialItem {
  key: ClinicalAccessSector;
  label: string;
  /** Absent when the patient cannot use the topic: the sector stays, greyed out. */
  onOpen?: () => void;
  badge?: number;
}

interface ClinicalAccessRadialMenuProps {
  anchor: HTMLElement;
  patientName: string;
  triggerKey: string;
  items: ClinicalAccessRadialItem[];
  onExplore?: () => void;
  /** Closes the ring and returns focus to its button. */
  onClose: () => void;
}

const ICONS: Record<ClinicalAccessSector, LucideIcon> = {
  ficha: ClipboardList,
  laboratory: FlaskConical,
  imaging: ScanLine,
  documents: FileText,
};

// Full class names, so Tailwind finds them.
const TONES: Record<ClinicalAccessSector, { text: string; fill: string }> = {
  ficha: {
    text: 'text-medical-700',
    fill: 'group-hover:fill-medical-50 group-focus-visible:fill-medical-50',
  },
  laboratory: {
    text: 'text-emerald-700',
    fill: 'group-hover:fill-emerald-50 group-focus-visible:fill-emerald-50',
  },
  imaging: {
    text: 'text-violet-700',
    fill: 'group-hover:fill-violet-50 group-focus-visible:fill-violet-50',
  },
  documents: {
    text: 'text-indigo-700',
    fill: 'group-hover:fill-indigo-50 group-focus-visible:fill-indigo-50',
  },
};

const ICON_SIZE = 16;
const CORE_ICON_SIZE = 26;
const VIEW_SIZE = RADIAL_VIEW_RADIUS * 2;

const Sector: React.FC<{
  item: ClinicalAccessRadialItem;
  index: number;
  pathId: string;
  testId: string;
  patientName: string;
  onActivate: () => void;
}> = ({ item, index, pathId, testId, patientName, onActivate }) => {
  const enabled = Boolean(item.onOpen);
  const Icon = ICONS[item.key];
  const icon = radialPoint(RADIAL_ICON_RADIUS, radialSectorMiddle(item.key));
  const badge = radialPoint(RADIAL_BADGE_RADIUS, radialSectorMiddle(item.key) - 32);
  return (
    <g
      role="menuitem"
      tabIndex={-1}
      aria-label={`${item.label} de ${patientName}`}
      aria-disabled={!enabled || undefined}
      data-sector={item.key}
      data-testid={testId}
      style={{ '--sector-index': index } as React.CSSProperties}
      className={clsx(
        'clinical-access-radial-sector group outline-none',
        TONES[item.key].text,
        enabled ? 'cursor-pointer' : 'cursor-not-allowed'
      )}
      onClick={onActivate}
    >
      <path
        d={radialSectorPath(item.key)}
        className={clsx(
          'fill-white/0 transition-colors duration-150',
          enabled && TONES[item.key].fill
        )}
      />
      <path id={pathId} d={radialLabelPath(item.key)} fill="none" />
      {enabled && (
        <path
          d={radialAccentPath(item.key)}
          className="fill-none stroke-current opacity-0 transition-opacity duration-150 [stroke-linecap:round] [stroke-width:1.6] group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      )}
      <g
        transform={`translate(${icon.x - ICON_SIZE / 2} ${icon.y - ICON_SIZE / 2})`}
        className={clsx(
          'transition-opacity duration-200',
          enabled
            ? 'opacity-60 group-hover:opacity-100 group-focus-visible:opacity-100'
            : 'text-slate-300'
        )}
      >
        <Icon width={ICON_SIZE} height={ICON_SIZE} strokeWidth={1.75} aria-hidden="true" />
      </g>
      <text
        className={clsx(
          'text-[7.5px] font-semibold uppercase tracking-[0.16em] transition-colors duration-150',
          enabled
            ? 'fill-slate-500 group-hover:fill-current group-focus-visible:fill-current'
            : 'fill-slate-300'
        )}
      >
        <textPath href={`#${pathId}`} startOffset="50%" textAnchor="middle">
          {item.label}
        </textPath>
      </text>
      {enabled && item.badge !== undefined && item.badge > 0 && (
        <g aria-hidden="true">
          <circle
            cx={badge.x}
            cy={badge.y}
            r={6.5}
            className="fill-teal-700 stroke-white [stroke-width:1.5]"
          />
          <text
            x={badge.x}
            y={badge.y + 2.5}
            textAnchor="middle"
            className="fill-white text-[7px] font-bold"
          >
            {item.badge > 99 ? '99+' : item.badge}
          </text>
        </g>
      )}
    </g>
  );
};

export const ClinicalAccessRadialMenu: React.FC<ClinicalAccessRadialMenuProps> = ({
  anchor,
  patientName,
  triggerKey,
  items,
  onExplore,
  onClose,
}) => {
  const idPrefix = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  // Measured once: the ring closes as soon as anything moves the button.
  const [center] = useState(() =>
    resolveRadialCenter(anchor.getBoundingClientRect(), {
      width: window.innerWidth,
      height: window.innerHeight,
    })
  );

  // The ring is pinned to where the button was: anything that moves the census closes it.
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, { capture: true, passive: true });
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, { capture: true });
    };
  }, [onClose]);

  useEffect(() => {
    const menu = menuRef.current;
    const first =
      menu?.querySelector<SVGGElement>('[data-sector="explorer"]:not([aria-disabled])') ??
      menu?.querySelector<SVGGElement>('[role="menuitem"]:not([aria-disabled])');
    first?.focus();
  }, []);

  const actions = new Map<string, (() => void) | undefined>([
    ...items.map(item => [item.key, item.onOpen] as const),
    ['explorer', onExplore],
  ]);
  const activate = (sector: string) => {
    const open = actions.get(sector);
    if (!open) return;
    onClose();
    open();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      onClose();
      return;
    }
    const current = (event.target as Element).closest('[data-sector]')?.getAttribute('data-sector');
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (current) activate(current);
      return;
    }
    const sector = RADIAL_ARROW_SECTORS[event.key];
    if (!sector) return;
    event.preventDefault();
    // From a sector, its opposite arrow returns to the centre.
    const next = current === sector ? 'explorer' : sector;
    menuRef.current?.querySelector<SVGGElement>(`[data-sector="${next}"]`)?.focus();
  };

  return createPortal(
    <div
      className="print:hidden"
      onClick={event => event.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      <div aria-hidden="true" className="fixed inset-0 z-[60]" onClick={onClose} />
      <div
        ref={menuRef}
        role="menu"
        aria-label={`Accesos de ${patientName}`}
        data-testid="clinical-access-menu"
        className="clinical-access-radial pointer-events-none fixed z-[61]"
        style={{
          left: center.x - RADIAL_VIEW_RADIUS,
          top: center.y - RADIAL_VIEW_RADIUS,
          width: VIEW_SIZE,
          height: VIEW_SIZE,
        }}
      >
        <svg
          viewBox={`${-RADIAL_VIEW_RADIUS} ${-RADIAL_VIEW_RADIUS} ${VIEW_SIZE} ${VIEW_SIZE}`}
          className="size-full overflow-visible"
        >
          <circle
            r={RADIAL_OUTER_RADIUS}
            className="clinical-access-radial-base pointer-events-auto fill-white"
          />
          <circle
            r={RADIAL_OUTER_RADIUS - 0.5}
            className="fill-none stroke-slate-900/[0.07] [stroke-width:1]"
          />
          {RADIAL_DIVIDERS.map(({ start, end }) => (
            <line
              key={`${start.x}:${start.y}`}
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              className="stroke-slate-200 [stroke-linecap:round] [stroke-width:1]"
            />
          ))}
          <g className="pointer-events-auto">
            {items.map((item, index) => (
              <Sector
                key={item.key}
                item={item}
                index={index}
                pathId={`${idPrefix}-${item.key}`}
                testId={`clinical-access-${item.key}-${triggerKey}`}
                patientName={patientName}
                onActivate={() => activate(item.key)}
              />
            ))}
            <g
              role="menuitem"
              tabIndex={-1}
              aria-label={`Explorador clínico de ${patientName}`}
              aria-disabled={!onExplore || undefined}
              data-sector="explorer"
              data-testid={`clinical-access-explorer-${triggerKey}`}
              className={clsx(
                'clinical-access-radial-core group outline-none',
                onExplore ? 'cursor-pointer' : 'cursor-not-allowed'
              )}
              onClick={() => activate('explorer')}
            >
              {onExplore && (
                <circle
                  r={RADIAL_CORE_RADIUS + 3.5}
                  className="origin-center fill-none stroke-teal-700 opacity-0 transition-opacity duration-200 [stroke-dasharray:2_3.2] [stroke-width:1.2] [transform-box:fill-box] group-hover:animate-[spin_14s_linear_infinite] group-hover:opacity-90 group-focus-visible:animate-[spin_14s_linear_infinite] group-focus-visible:opacity-90 motion-reduce:animate-none"
                />
              )}
              <circle
                r={RADIAL_CORE_RADIUS}
                className="fill-white stroke-slate-200 [stroke-width:1]"
              />
              <image
                href={CLINICAL_ACCESS_MANUTARA_SRC}
                x={-CORE_ICON_SIZE / 2}
                y={-CORE_ICON_SIZE / 2}
                width={CORE_ICON_SIZE}
                height={CORE_ICON_SIZE}
                className={clsx(
                  'origin-center transition duration-300 [transform-box:fill-box]',
                  onExplore
                    ? 'group-hover:-rotate-6 group-hover:scale-105 group-focus-visible:-rotate-6 group-focus-visible:scale-105'
                    : 'opacity-30'
                )}
              />
            </g>
          </g>
        </svg>
      </div>
    </div>,
    document.body
  );
};
