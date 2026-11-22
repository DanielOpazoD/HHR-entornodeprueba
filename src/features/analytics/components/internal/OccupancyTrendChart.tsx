/**
 * OccupancyTrendChart Component
 * Line chart showing daily occupancy rate trend
 */

import React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { DailyStatsSnapshot } from '@/features/analytics/types/minsalTypes';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { resolveAnalyticsPresentationCopy } from '@/features/analytics/controllers/minsalAnalyticsPresentationController';

interface OccupancyTrendChartProps {
  data: DailyStatsSnapshot[];
}

interface ChartTooltipDatum extends DailyStatsSnapshot {
  displayDate: string;
}

interface OccupancyTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: ChartTooltipDatum;
  }>;
  label?: string;
}

const OccupancyTooltip: React.FC<OccupancyTooltipProps> = ({ active, payload, label }) => {
  const datum = payload?.[0]?.payload;
  if (!active || !datum) {
    return null;
  }

  const occupancy = typeof datum.tasaOcupacion === 'number' ? datum.tasaOcupacion : 0;
  const occupied = typeof datum.ocupadas === 'number' ? datum.ocupadas : 0;
  const available = typeof datum.disponibles === 'number' ? datum.disponibles : 0;
  const blocked = typeof datum.bloqueadas === 'number' ? datum.bloqueadas : 0;

  return (
    <div
      style={{
        borderRadius: '8px',
        border: 'none',
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        padding: '12px',
        background: '#fff',
      }}
    >
      <p className="text-slate-700 font-medium mb-2">Fecha: {label}</p>
      <p className="text-sky-500 text-lg mb-1">
        {resolveAnalyticsPresentationCopy().trendOccupancyLabel}: {occupancy}%
      </p>
      <p className="text-slate-600 text-sm">
        Fórmula usada: {occupied} / {available} camas habilitadas
      </p>
      <p className="text-slate-500 text-xs mt-1">Camas bloqueadas: {blocked}</p>
    </div>
  );
};

export const OccupancyTrendChart: React.FC<OccupancyTrendChartProps> = ({ data }) => {
  const copy = resolveAnalyticsPresentationCopy();
  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-slate-400">
        No hay datos de tendencia para el período seleccionado.
      </div>
    );
  }

  // Format date for display in Chilean format (DD-MM-YYYY)
  const formattedData = data.map(d => ({
    ...d,
    displayDate: formatDateDDMMYYYY(d.date),
  }));

  // Calculate average occupancy
  const avgOccupancy = data.reduce((sum, d) => sum + d.tasaOcupacion, 0) / data.length;

  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={formattedData} margin={{ top: 10, right: 30, left: 0, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis
            dataKey="displayDate"
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickLine={false}
            axisLine={{ stroke: '#e2e8f0' }}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={value => `${value}%`}
          />
          <Tooltip content={<OccupancyTooltip />} />

          {/* Reference line for average */}
          <ReferenceLine
            y={avgOccupancy}
            stroke="#94a3b8"
            strokeDasharray="5 5"
            label={{
              value: `${copy.trendAverageLabel}: ${avgOccupancy.toFixed(1)}%`,
              position: 'right',
              fill: '#64748b',
              fontSize: 10,
            }}
          />

          {/* Main occupancy line */}
          <Line
            type="monotone"
            dataKey="tasaOcupacion"
            stroke="#0ea5e9"
            strokeWidth={3}
            dot={{ r: 4, fill: '#0ea5e9', strokeWidth: 2, stroke: '#fff' }}
            activeDot={{ r: 6, fill: '#0284c7', stroke: '#fff', strokeWidth: 2 }}
          />

          {/* Hidden line for occupied beds just to show in tooltip */}
          <Line
            type="monotone"
            dataKey="ocupadas"
            stroke="transparent"
            strokeWidth={0}
            dot={false}
            activeDot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default OccupancyTrendChart;
