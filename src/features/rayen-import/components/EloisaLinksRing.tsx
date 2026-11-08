/**
 * The small ring that opens from the Eloísa mark in the census toolbar: Hospitalizados, Gestión
 * de camas, Ambulatoria and Urgencias around the mark, each opening Eloísa in a new tab. It follows
 * the mark while the page scrolls and closes on Escape, Tab, an outside click, a chosen link or
 * once the mark leaves the screen, handing focus back to the mark.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BedDouble, Hospital, Siren, Stethoscope, type LucideIcon } from 'lucide-react';

import { ELOISA_LINKS, type EloisaLinkKey } from '../eloisaLinks';
import './eloisaLinksRing.css';

const VIEW_RADIUS = 66;
const OUTER_RADIUS = 60;
const INNER_RADIUS = 19;
const SECTOR_GAP = 2.5;
const ICON_RADIUS = 32;
const ICON_SIZE = 13;
const MARK_SIZE = 22;
const VIEWPORT_MARGIN = 8;

// Clockwise from the top, so each arrow key points at its sector.
const SECTORS: Record<EloisaLinkKey, { from: number; to: number; icon: LucideIcon }> = {
  hospitalized: { from: -135, to: -45, icon: Hospital },
  beds: { from: -45, to: 45, icon: BedDouble },
  outpatient: { from: 45, to: 135, icon: Stethoscope },
  emergency: { from: 135, to: 225, icon: Siren },
};

const ARROWS: Record<string, EloisaLinkKey> = {
  ArrowUp: 'hospitalized',
  ArrowRight: 'beds',
  ArrowDown: 'outpatient',
  ArrowLeft: 'emergency',
};

const point = (radius: number, degrees: number): string => {
  const radians = (degrees * Math.PI) / 180;
  return `${(radius * Math.cos(radians)).toFixed(2)} ${(radius * Math.sin(radians)).toFixed(2)}`;
};

// The angle that leaves half the gap at this radius, so the gap keeps one width end to end.
const halfGap = (radius: number): number => (Math.asin(SECTOR_GAP / 2 / radius) * 180) / Math.PI;

const sectorPath = (from: number, to: number): string =>
  [
    `M ${point(OUTER_RADIUS, from + halfGap(OUTER_RADIUS))}`,
    `A ${OUTER_RADIUS} ${OUTER_RADIUS} 0 0 1 ${point(OUTER_RADIUS, to - halfGap(OUTER_RADIUS))}`,
    `L ${point(INNER_RADIUS, to - halfGap(INNER_RADIUS))}`,
    `A ${INNER_RADIUS} ${INNER_RADIUS} 0 0 0 ${point(INNER_RADIUS, from + halfGap(INNER_RADIUS))}`,
    'Z',
  ].join(' ');

// Text runs clockwise except at the bottom, where it runs the other way so it is never upside
// down; that baseline sits further out because its letters grow towards the centre.
const labelPath = (key: EloisaLinkKey, from: number, to: number): string =>
  key === 'outpatient'
    ? `M ${point(53, to)} A 53 53 0 0 0 ${point(53, from)}`
    : `M ${point(48, from)} A 48 48 0 0 1 ${point(48, to)}`;

const clamp = (value: number, size: number): number => {
  const reach = VIEW_RADIUS + VIEWPORT_MARGIN;
  if (size < reach * 2) return size / 2;
  return Math.min(Math.max(value, reach), size - reach);
};

const measureCenter = (anchor: HTMLElement) => {
  const box = anchor.getBoundingClientRect();
  return {
    x: clamp(box.left + box.width / 2, window.innerWidth),
    y: clamp(box.top + box.height / 2, window.innerHeight),
  };
};

interface EloisaLinksRingProps {
  anchor: HTMLElement;
  /** Closes the ring and returns focus to the mark. */
  onClose: () => void;
}

export const EloisaLinksRing: React.FC<EloisaLinksRingProps> = ({ anchor, onClose }) => {
  const idPrefix = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const [center, setCenter] = useState(() => measureCenter(anchor));

  useEffect(() => {
    let frame = 0;
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = anchor.getBoundingClientRect();
        const offScreen =
          box.bottom <= 0 ||
          box.right <= 0 ||
          box.top >= window.innerHeight ||
          box.left >= window.innerWidth;
        if (offScreen || !anchor.isConnected) onClose();
        else setCenter(measureCenter(anchor));
      });
    };
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, { capture: true });
    };
  }, [anchor, onClose]);

  // With no address known yet, the menu itself holds the focus so Escape and Tab still close it.
  useEffect(() => {
    const menu = menuRef.current;
    (menu?.querySelector<SVGAElement>('a[href]') ?? menu)?.focus();
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      onClose();
      return;
    }
    const key = ARROWS[event.key];
    if (!key) return;
    event.preventDefault();
    menuRef.current?.querySelector<SVGElement>(`[data-eloisa-link="${key}"]`)?.focus();
  };

  return createPortal(
    <div className="print:hidden" onKeyDown={handleKeyDown}>
      <div aria-hidden="true" className="fixed inset-0 z-[60]" onClick={onClose} />
      <div
        ref={menuRef}
        role="menu"
        tabIndex={-1}
        aria-label="Accesos a Eloísa"
        data-testid="eloisa-links-menu"
        className="eloisa-links-ring pointer-events-none fixed z-[61] outline-none"
        style={{
          left: center.x - VIEW_RADIUS,
          top: center.y - VIEW_RADIUS,
          width: VIEW_RADIUS * 2,
          height: VIEW_RADIUS * 2,
        }}
      >
        <svg
          viewBox={`${-VIEW_RADIUS} ${-VIEW_RADIUS} ${VIEW_RADIUS * 2} ${VIEW_RADIUS * 2}`}
          className="size-full overflow-visible"
        >
          <circle
            r={OUTER_RADIUS}
            className="pointer-events-auto fill-white [filter:drop-shadow(0_14px_22px_rgb(15_118_110/0.18))_drop-shadow(0_2px_4px_rgb(15_23_42/0.07))]"
          />
          {ELOISA_LINKS.map(link => {
            const { from, to, icon: Icon } = SECTORS[link.key];
            const middle = ((from + to) / 2) * (Math.PI / 180);
            const iconX = ICON_RADIUS * Math.cos(middle) - ICON_SIZE / 2;
            const iconY = ICON_RADIUS * Math.sin(middle) - ICON_SIZE / 2;
            const pathId = `${idPrefix}-${link.key}`;
            const body = (
              <>
                <path
                  d={sectorPath(from, to)}
                  className={
                    link.href
                      ? 'fill-emerald-50 stroke-emerald-200 transition-colors duration-150 [stroke-width:1] group-hover:fill-emerald-100 group-hover:stroke-emerald-300 group-focus-visible:fill-emerald-100 group-focus-visible:stroke-emerald-300'
                      : 'fill-slate-50 stroke-slate-200 [stroke-width:1]'
                  }
                />
                <path id={pathId} d={labelPath(link.key, from, to)} fill="none" />
                <g transform={`translate(${iconX} ${iconY})`}>
                  <Icon
                    width={ICON_SIZE}
                    height={ICON_SIZE}
                    strokeWidth={1.75}
                    aria-hidden="true"
                    className={link.href ? 'text-emerald-700' : 'text-slate-300'}
                  />
                </g>
                <text
                  className={`text-[5.8px] font-bold uppercase tracking-[0.08em] ${
                    link.href ? 'fill-emerald-700' : 'fill-slate-300'
                  }`}
                >
                  <textPath href={`#${pathId}`} startOffset="50%" textAnchor="middle">
                    {link.ringLabel ?? link.label}
                  </textPath>
                </text>
              </>
            );
            return link.href ? (
              <a
                key={link.key}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                role="menuitem"
                tabIndex={-1}
                aria-label={`${link.label} en Eloísa`}
                data-eloisa-link={link.key}
                data-testid={`eloisa-link-${link.key}`}
                className="group pointer-events-auto cursor-pointer outline-none"
                onClick={onClose}
              >
                {body}
              </a>
            ) : (
              <g
                key={link.key}
                role="menuitem"
                tabIndex={-1}
                aria-disabled="true"
                aria-label={`${link.label} en Eloísa: falta su dirección`}
                data-eloisa-link={link.key}
                data-testid={`eloisa-link-${link.key}`}
                className="pointer-events-auto cursor-not-allowed outline-none"
              >
                {body}
              </g>
            );
          })}
          <circle r={INNER_RADIUS - 3} className="fill-white stroke-emerald-200 [stroke-width:1]" />
          <image
            href="/images/logos/rayen-mark.png"
            x={-MARK_SIZE / 2}
            y={-MARK_SIZE / 2}
            width={MARK_SIZE}
            height={MARK_SIZE}
          />
        </svg>
      </div>
    </div>,
    document.body
  );
};
