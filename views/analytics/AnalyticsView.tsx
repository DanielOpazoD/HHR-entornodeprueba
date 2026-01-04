import React, { useMemo, useState, useEffect } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line, PieChart, Pie, Cell, Legend } from 'recharts';
import { getAllRecords } from '@/services/storage/indexedDBService';
import { calculateStats } from '@/services/calculations/statsCalculator';
import { DailyRecord, Specialty, PatientData } from '@/types';
import { BEDS } from '@/constants';
import { Loader2 } from 'lucide-react';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658'];

export const AnalyticsView: React.FC = () => {
    const [allRecords, setAllRecords] = useState<DailyRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadData = async () => {
            const recordsMap = await getAllRecords();
            const recordsList = Object.values(recordsMap).sort((a, b) =>
                new Date(b.date).getTime() - new Date(a.date).getTime()
            );
            setAllRecords(recordsList);
            setIsLoading(false);
        };
        loadData();
    }, []);

    // Calculate trends over time
    const trendData = useMemo(() => {
        return allRecords.map(record => {
            const stats = calculateStats(record.beds);
            return {
                date: record.date.substring(5), // MM-DD
                total: stats.totalHospitalized,
                occupiedBeds: stats.occupiedBeds,
                occupiedCribs: stats.occupiedCribs,
                blocked: stats.blockedBeds
            };
        }).reverse(); // Chronological
    }, [allRecords]);

    // Current snapshot (latest date)
    const latestRecord = allRecords[0];

    const specialtyData = useMemo(() => {
        if (!latestRecord) return [];
        const counts: Record<string, number> = {};

        Object.values(latestRecord.beds).forEach((p: PatientData) => {
            if (p.patientName && !p.isBlocked && p.specialty) {
                counts[p.specialty] = (counts[p.specialty] || 0) + 1;
            }
        });

        return Object.entries(counts).map(([name, value]) => ({ name, value }));
    }, [latestRecord]);

    const bedTypeData = useMemo(() => {
        if (!latestRecord) return [];
        let uti = 0;
        let media = 0;

        Object.entries(latestRecord.beds).forEach(([bedId, p]) => {
            const patient = p as PatientData;
            const bedDef = BEDS.find(b => b.id === bedId);
            if (patient.patientName && !patient.isBlocked && bedDef) {
                if (bedDef.type === 'UTI') uti++;
                else media++;
            }
        });

        return [
            { name: 'UTI', value: uti },
            { name: 'Media/Cuna', value: media }
        ];
    }, [latestRecord]);


    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin mb-2" />
                <p>Cargando estadísticas...</p>
            </div>
        );
    }

    if (allRecords.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                <p>No hay datos suficientes para generar estadísticas.</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-fade-in">
            <header>
                <h2 className="text-2xl font-bold text-slate-800">Panel Estadístico</h2>
                <p className="text-slate-500">Análisis histórico y distribución actual</p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Occupancy Trend */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <h3 className="font-bold text-slate-700 mb-4">Evolución de Ocupación (Últimos 30 registros)</h3>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChartComponent data={trendData} />
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Specialty Breakdown */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <h3 className="font-bold text-slate-700 mb-4">Pacientes por Especialidad (Actual)</h3>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={specialtyData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    fill="#8884d8"
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {specialtyData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Bed Type Distribution */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <h3 className="font-bold text-slate-700 mb-4">Complejidad (UTI vs Media)</h3>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={bedTypeData} layout="vertical">
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis type="number" />
                                <YAxis dataKey="name" type="category" width={100} />
                                <Tooltip />
                                <Bar dataKey="value" fill="#0ea5e9" barSize={30} radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* KPIs */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-center">
                    <h3 className="font-bold text-slate-700 mb-6">Indicadores Clave</h3>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-blue-50 rounded-lg text-center">
                            <div className="text-3xl font-bold text-blue-600">
                                {((latestRecord && calculateStats(latestRecord.beds).totalHospitalized / 18) * 100).toFixed(1)}%
                            </div>
                            <div className="text-xs text-blue-800 font-medium uppercase mt-1">Ocupación Actual</div>
                        </div>
                        <div className="p-4 bg-orange-50 rounded-lg text-center">
                            <div className="text-3xl font-bold text-orange-600">
                                {Object.values(latestRecord?.beds || {}).filter((b) => (b as PatientData).status === 'Grave').length}
                            </div>
                            <div className="text-xs text-orange-800 font-medium uppercase mt-1">Pacientes Graves</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Chart data type
interface TrendDataPoint {
    date: string;
    total: number;
    occupiedBeds: number;
    occupiedCribs: number;
    blocked: number;
}

// Helper component for the area/line chart
const AreaChartComponent = ({ data }: { data: TrendDataPoint[] }) => (
    <LineChart data={data} margin={{ top: 5, right: 20, left: -20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#94a3b8" />
        <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" />
        <Tooltip
            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
        />
        <Line type="monotone" dataKey="total" stroke="#0ea5e9" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} name="Total" />
        <Line type="monotone" dataKey="blocked" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 5" name="Bloqueadas" />
    </LineChart>
);