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
import { DailyStatsSnapshot } from '@/types/minsalTypes';

interface OccupancyTrendChartProps {
    data: DailyStatsSnapshot[];
}

export const OccupancyTrendChart: React.FC<OccupancyTrendChartProps> = ({
    data,
}) => {
    if (data.length === 0) {
        return (
            <div className="h-64 flex items-center justify-center text-slate-400">
                No hay datos de tendencia para el período seleccionado.
            </div>
        );
    }

    // Format date for display
    const formattedData = data.map((d) => ({
        ...d,
        displayDate: d.date.substring(5), // MM-DD
    }));

    // Calculate average occupancy
    const avgOccupancy =
        data.reduce((sum, d) => sum + d.tasaOcupacion, 0) / data.length;

    return (
        <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart
                    data={formattedData}
                    margin={{ top: 10, right: 30, left: 0, bottom: 10 }}
                >
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
                        tickFormatter={(value) => `${value}%`}
                    />
                    <Tooltip
                        contentStyle={{
                            borderRadius: '8px',
                            border: 'none',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                            padding: '12px',
                        }}
                        formatter={(value, name) => {
                            const labels: Record<string, string> = {
                                tasaOcupacion: 'Tasa Ocupación',
                                ocupadas: 'Camas Ocupadas',
                                egresos: 'Egresos',
                            };
                            const numValue = typeof value === 'number' ? value : 0;
                            const strName = typeof name === 'string' ? name : '';
                            return [
                                strName === 'tasaOcupacion' ? `${numValue}%` : numValue,
                                labels[strName] || strName,
                            ];
                        }}
                        labelFormatter={(label) => `Fecha: ${label}`}
                    />

                    {/* Reference line for average */}
                    <ReferenceLine
                        y={avgOccupancy}
                        stroke="#94a3b8"
                        strokeDasharray="5 5"
                        label={{
                            value: `Promedio: ${avgOccupancy.toFixed(1)}%`,
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

                    {/* Occupied beds as secondary line */}
                    <Line
                        type="monotone"
                        dataKey="ocupadas"
                        stroke="#22c55e"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={false}
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
};

export default OccupancyTrendChart;
