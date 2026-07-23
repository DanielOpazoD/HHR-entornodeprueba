import React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceArea,
} from 'recharts';
import type { LabTrendPoint } from '@/types/domain/labAnalyticsTypes';
import {
  formatLabTrendValue,
  resolveSharedReferenceBand,
  sortByDate,
} from './LabTrendChartHelpers';
import { DASH_PATTERNS, LABEL_OFFSETS, LINE_COLORS } from '../constants/labChartConstants';

export const StaggeredLabel: React.FC<{
  x?: number;
  y?: number;
  value?: number;
  color: string;
  labelConfig: { position: 'top' | 'bottom'; dy: number };
}> = ({ x, y, value, color, labelConfig }) => {
  if (x == null || y == null || value == null) return null;

  return (
    <text
      x={x}
      y={y + labelConfig.dy}
      textAnchor="middle"
      fill={color}
      fontSize={9}
      fontWeight={700}
    >
      {formatLabTrendValue(value)}
    </text>
  );
};

export const LabTrendTooltip: React.FC<{
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    payload: { date: string; __points: Record<string, LabTrendPoint> };
  }>;
}> = ({ active, payload }) => {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg">
      <p className="mb-1 text-[11px] font-semibold text-slate-700">{payload[0]?.payload?.date}</p>
      {payload.map(entry => {
        const point = entry.payload.__points[entry.name];
        return (
          <div key={entry.name} className="border-t border-slate-100 py-1 first:border-0">
            <p className="text-[12px]">
              <span className="font-bold">{entry.name}: </span>
              {formatLabTrendValue(entry.value)} {point?.unit}
            </p>
            {point?.rawValue ? (
              <p className="text-[10px] text-slate-500">Original Syslab: {point.rawValue}</p>
            ) : null}
            {point?.sourceSection ? (
              <p className="text-[10px] text-slate-500">Sección: {point.sourceSection}</p>
            ) : null}
            {point?.refMin != null && point.refMax != null ? (
              <p className="text-[10px] text-slate-400">
                Ref: {formatLabTrendValue(point.refMin)} - {formatLabTrendValue(point.refMax)}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

export const UnitSubChart: React.FC<{
  varEntries: Record<string, LabTrendPoint[]>;
  unit: string;
  colorOffset: number;
}> = ({ varEntries, unit, colorOffset }) => {
  const varNames = Object.keys(varEntries);
  const dateMap: Record<
    string,
    { date: string; __points: Record<string, LabTrendPoint>; [key: string]: unknown }
  > = {};

  for (const [name, points] of Object.entries(varEntries)) {
    for (const point of points) {
      if (!dateMap[point.date]) {
        dateMap[point.date] = { date: point.date, __points: {} };
      }
      dateMap[point.date][name] = point.value;
      dateMap[point.date].__points[name] = point;
    }
  }

  const chartData = Object.values(dateMap).sort((a, b) => sortByDate(a.date, b.date));

  const allVals: number[] = [];
  for (const points of Object.values(varEntries)) {
    for (const point of points) {
      allVals.push(point.value);
      if (point.refMin != null) allVals.push(point.refMin);
      if (point.refMax != null) allVals.push(point.refMax);
    }
  }

  const yMin = Math.floor(Math.min(...allVals) * 0.85);
  const yMax = Math.ceil(Math.max(...allVals) * 1.15);
  const sharedReference = resolveSharedReferenceBand(varEntries);
  const extraMargin = varNames.length > 2 ? 30 : 18;

  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap gap-3">
        {varNames.map((name, index) => {
          const colorIndex = (index + colorOffset) % LINE_COLORS.length;
          const dash = DASH_PATTERNS[index % DASH_PATTERNS.length];

          return (
            <span key={name} className="inline-flex items-center gap-1.5 text-[10px] font-medium">
              <svg width="18" height="8">
                <line
                  x1="0"
                  y1="4"
                  x2="18"
                  y2="4"
                  stroke={LINE_COLORS[colorIndex]}
                  strokeWidth={2.5}
                  strokeDasharray={dash || undefined}
                />
              </svg>
              <span style={{ color: LINE_COLORS[colorIndex] }}>{name}</span>
              <span className="text-slate-400">({unit})</span>
            </span>
          );
        })}
      </div>
      <div className="h-52 min-w-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart
            data={chartData}
            margin={{ top: extraMargin, right: 25, left: 0, bottom: extraMargin }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 9, fill: '#64748b' }}
              tickLine={false}
              axisLine={{ stroke: '#e2e8f0' }}
            />
            <YAxis
              domain={[yMin, yMax]}
              tick={{ fontSize: 9, fill: '#64748b' }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<LabTrendTooltip />} />

            {sharedReference && (
              <ReferenceArea
                y1={sharedReference.min}
                y2={sharedReference.max}
                fill="#10b981"
                fillOpacity={0.06}
                stroke="#10b981"
                strokeOpacity={0.15}
                strokeDasharray="3 3"
              />
            )}

            {varNames.map((name, index) => {
              const colorIndex = (index + colorOffset) % LINE_COLORS.length;
              const dash = DASH_PATTERNS[index % DASH_PATTERNS.length];
              const labelConfig = LABEL_OFFSETS[index % LABEL_OFFSETS.length];
              const color = LINE_COLORS[colorIndex];

              return (
                <Line
                  key={name}
                  name={name}
                  type="linear"
                  dataKey={name}
                  stroke={color}
                  strokeWidth={2.5}
                  strokeDasharray={dash || undefined}
                  dot={{
                    r: 3 + (index % 2),
                    fill: color,
                    strokeWidth: 2,
                    stroke: '#fff',
                  }}
                  activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }}
                  label={<StaggeredLabel color={color} labelConfig={labelConfig} />}
                  connectNulls
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
