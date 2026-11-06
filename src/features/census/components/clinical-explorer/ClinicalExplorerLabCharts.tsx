import React, { useLayoutEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import {
  buildLabAxisDays,
  buildNiceTicks,
  calendarDaysBetween,
  formatLabNumber,
  type LabPoint,
  type LabVariable,
} from './clinicalExplorerLabModel';

interface ClinicalExplorerLabChartsProps {
  variables: LabVariable[];
  /** First day on the axis: the admission or the first report, whichever is earlier. */
  startIso: string;
  /** Last day on the axis: the census day. */
  endIso: string;
  admissionIso: string;
  selectedDay: string | null;
  onSelectDay: (dayIso: string) => void;
  expanded: boolean;
}

const PAD_LEFT = 44;
const PAD_RIGHT = 34;
const TOP = 24;
const BOTTOM = 6;
const AXIS_HEIGHT = 22;
const ddmm = (iso: string): string => formatDateDDMMYYYY(iso).slice(0, 5);

interface Hover {
  variable: string;
  point: LabPoint;
  x: number;
  y: number;
}

/**
 * One small chart per variable, each with its own scale and unit, over one shared day axis. No
 * reference band and no colour for "high" or "low": the values are shown, not interpreted.
 */
export const ClinicalExplorerLabCharts: React.FC<ClinicalExplorerLabChartsProps> = ({
  variables,
  startIso,
  endIso,
  admissionIso,
  selectedDay,
  onSelectDay,
  expanded,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<Hover | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = (): void => setWidth(Math.max(320, host.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const dayCount = Math.max(1, calendarDaysBetween(startIso, endIso) + 1);
  const innerWidth = width - PAD_LEFT - PAD_RIGHT;
  const xFor = (dayIso: string): number =>
    PAD_LEFT + ((calendarDaysBetween(startIso, dayIso) + 0.5) / dayCount) * innerWidth;
  const panelHeight = expanded ? 136 : 100;
  const axisDays = buildLabAxisDays(startIso, endIso, innerWidth);
  const spansYears = startIso.slice(0, 4) !== endIso.slice(0, 4);
  const showAdmission = admissionIso >= startIso && admissionIso <= endIso;

  return (
    <div ref={hostRef} className="relative flex flex-col gap-0.5">
      {variables.map((variable, panelIndex) => {
        const values = variable.points.map(point => point.value);
        const scale = buildNiceTicks(Math.min(...values), Math.max(...values));
        const yFor = (value: number): number =>
          TOP +
          (1 - (value - scale.min) / (scale.max - scale.min || 1)) * (panelHeight - TOP - BOTTOM);
        const path = variable.points
          .map(
            (point, index) =>
              `${index ? 'L' : 'M'}${xFor(point.dayIso).toFixed(1)} ${yFor(point.value).toFixed(1)}`
          )
          .join(' ');
        const last = variable.points[variable.points.length - 1];
        return (
          <div key={variable.name} className="relative">
            <div className="pointer-events-none absolute left-0 top-0 flex items-baseline gap-1.5 text-[11px] font-semibold text-slate-700">
              {variable.name}
              <span className="text-[10px] font-normal text-slate-400">{variable.unit}</span>
            </div>
            <svg
              role="img"
              aria-label={`${variable.name}, ${variable.points.length} resultados en ${variable.unit || 'sin unidad'}`}
              viewBox={`0 0 ${width} ${panelHeight}`}
              width={width}
              height={panelHeight}
              className="block overflow-visible font-sans"
            >
              {scale.ticks.map(tick => (
                <g key={tick}>
                  <line
                    x1={PAD_LEFT}
                    x2={PAD_LEFT + innerWidth}
                    y1={yFor(tick)}
                    y2={yFor(tick)}
                    stroke="#f1f5f9"
                  />
                  <text
                    x={PAD_LEFT - 6}
                    y={yFor(tick) + 3}
                    textAnchor="end"
                    fontSize={10}
                    fill="#94a3b8"
                    className="tabular-nums"
                  >
                    {formatLabNumber(tick)}
                  </text>
                </g>
              ))}
              {showAdmission && (
                <>
                  <line
                    x1={xFor(admissionIso)}
                    x2={xFor(admissionIso)}
                    y1={TOP - 4}
                    y2={panelHeight - BOTTOM}
                    stroke="#94a3b8"
                    strokeDasharray="2 3"
                  />
                  {panelIndex === 0 && (
                    <text
                      x={xFor(admissionIso) + 3}
                      y={TOP - 6}
                      fontSize={9}
                      fontWeight={600}
                      fill="#64748b"
                    >
                      Ingreso
                    </text>
                  )}
                </>
              )}
              {selectedDay && selectedDay >= startIso && selectedDay <= endIso && (
                <line
                  x1={xFor(selectedDay)}
                  x2={xFor(selectedDay)}
                  y1={TOP - 4}
                  y2={panelHeight - BOTTOM}
                  stroke="#0369a1"
                />
              )}
              <path
                d={path}
                fill="none"
                stroke="#059669"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {variable.points.map(point => (
                <circle
                  key={point.columnKey}
                  cx={xFor(point.dayIso)}
                  cy={yFor(point.value)}
                  r={point.dayIso === selectedDay ? 6 : 4}
                  fill="#059669"
                  stroke="#fff"
                  strokeWidth={2}
                />
              ))}
              {last && (
                <text
                  x={xFor(last.dayIso) + 9}
                  y={yFor(last.value) + 4}
                  fontSize={11}
                  fontWeight={600}
                  fill="#334155"
                  className="tabular-nums"
                >
                  {last.display}
                </text>
              )}
              {variable.points.map(point => (
                <rect
                  key={`hit-${point.columnKey}`}
                  x={xFor(point.dayIso) - innerWidth / dayCount / 2}
                  y={0}
                  width={Math.max(12, innerWidth / dayCount)}
                  height={panelHeight}
                  fill="transparent"
                  className="cursor-pointer"
                  tabIndex={0}
                  role="button"
                  aria-label={`${variable.name} ${point.display} ${variable.unit} el ${formatDateDDMMYYYY(point.dayIso)}${point.time ? ` ${point.time}` : ''}`}
                  onMouseEnter={() =>
                    setHover({
                      variable: variable.name,
                      point,
                      x: xFor(point.dayIso),
                      y: yFor(point.value) + panelIndex * (panelHeight + 2),
                    })
                  }
                  onFocus={() =>
                    setHover({
                      variable: variable.name,
                      point,
                      x: xFor(point.dayIso),
                      y: yFor(point.value) + panelIndex * (panelHeight + 2),
                    })
                  }
                  onMouseLeave={() => setHover(null)}
                  onBlur={() => setHover(null)}
                  onClick={() => onSelectDay(point.dayIso)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectDay(point.dayIso);
                    }
                  }}
                />
              ))}
            </svg>
          </div>
        );
      })}
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${width} ${AXIS_HEIGHT}`}
        width={width}
        height={AXIS_HEIGHT}
        className="block overflow-visible font-sans"
      >
        <line x1={PAD_LEFT} x2={PAD_LEFT + innerWidth} y1={1} y2={1} stroke="#e2e8f0" />
        {axisDays.map(dayIso => {
          const isCensus = dayIso === endIso;
          return (
            <text
              key={dayIso}
              x={xFor(dayIso)}
              y={15}
              textAnchor="middle"
              fontSize={10}
              fontWeight={isCensus ? 700 : 400}
              fill={isCensus ? '#334155' : '#94a3b8'}
              className="tabular-nums"
            >
              {spansYears ? formatDateDDMMYYYY(dayIso) : ddmm(dayIso)}
              {isCensus ? ' censo' : ''}
            </text>
          );
        })}
      </svg>
      {hover && (
        <div
          role="tooltip"
          className={clsx(
            'pointer-events-none absolute z-20 rounded-md bg-slate-800 px-2 py-1 text-[11px] leading-snug text-white shadow-lg'
          )}
          style={{ left: Math.min(hover.x + 10, width - 150), top: hover.y + 10 }}
        >
          <b className="font-semibold">{hover.variable}</b> ·{' '}
          {formatDateDDMMYYYY(hover.point.dayIso)}
          {hover.point.time ? ` ${hover.point.time}` : ''}
          <br />
          {hover.point.display}
        </div>
      )}
    </div>
  );
};
