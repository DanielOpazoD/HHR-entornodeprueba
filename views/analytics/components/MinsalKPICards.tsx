/**
 * MinsalKPICards Component
 * Displays key MINSAL/DEIS performance indicators in card format
 */

import React from 'react';
import {
    Bed,
    TrendingUp,
    Calendar,
    Users,
    Activity,
    RefreshCw,
} from 'lucide-react';
import { MinsalStatistics } from '@/types/minsalTypes';

interface MinsalKPICardsProps {
    stats: MinsalStatistics;
}

interface KPICardProps {
    title: string;
    value: string | number;
    subtitle?: string;
    icon: React.ReactNode;
    color: 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'slate';
    trend?: 'up' | 'down' | 'neutral';
}

const colorClasses = {
    blue: {
        bg: 'bg-blue-50',
        text: 'text-blue-600',
        icon: 'bg-blue-100 text-blue-600',
    },
    green: {
        bg: 'bg-emerald-50',
        text: 'text-emerald-600',
        icon: 'bg-emerald-100 text-emerald-600',
    },
    orange: {
        bg: 'bg-orange-50',
        text: 'text-orange-600',
        icon: 'bg-orange-100 text-orange-600',
    },
    red: {
        bg: 'bg-red-50',
        text: 'text-red-600',
        icon: 'bg-red-100 text-red-600',
    },
    purple: {
        bg: 'bg-purple-50',
        text: 'text-purple-600',
        icon: 'bg-purple-100 text-purple-600',
    },
    slate: {
        bg: 'bg-slate-50',
        text: 'text-slate-600',
        icon: 'bg-slate-100 text-slate-600',
    },
};

const KPICard: React.FC<KPICardProps> = ({
    title,
    value,
    subtitle,
    icon,
    color,
}) => {
    const colors = colorClasses[color];

    return (
        <div className={`${colors.bg} rounded-xl p-4 border border-slate-200/50`}>
            <div className="flex items-start justify-between mb-2">
                <div className={`p-2 rounded-lg ${colors.icon}`}>{icon}</div>
            </div>
            <div className={`text-3xl font-bold ${colors.text} mb-1`}>{value}</div>
            <div className="text-sm font-medium text-slate-700">{title}</div>
            {subtitle && (
                <div className="text-xs text-slate-500 mt-1">{subtitle}</div>
            )}
        </div>
    );
};

export const MinsalKPICards: React.FC<MinsalKPICardsProps> = ({ stats }) => {
    return (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {/* Tasa de Ocupación */}
            <KPICard
                title="Tasa Ocupación"
                value={`${stats.tasaOcupacion}%`}
                subtitle="Índice Ocupacional MINSAL"
                icon={<Bed className="w-5 h-5" />}
                color="blue"
            />

            {/* Promedio Días Estada */}
            <KPICard
                title="Estada Media"
                value={`${stats.promedioDiasEstada}d`}
                subtitle="Promedio días hospitalización"
                icon={<Calendar className="w-5 h-5" />}
                color="green"
            />

            {/* Egresos Total */}
            <KPICard
                title="Egresos"
                value={stats.egresosTotal}
                subtitle={`${stats.egresosVivos} vivos, ${stats.egresosTraslados} trasl.`}
                icon={<Users className="w-5 h-5" />}
                color="purple"
            />

            {/* Mortalidad */}
            <KPICard
                title="Mortalidad"
                value={`${stats.mortalidadHospitalaria}%`}
                subtitle={`${stats.egresosFallecidos} fallecidos`}
                icon={<Activity className="w-5 h-5" />}
                color={stats.mortalidadHospitalaria > 5 ? 'red' : 'orange'}
            />

            {/* Índice Rotación */}
            <KPICard
                title="Rotación"
                value={stats.indiceRotacion}
                subtitle="Egresos/cama/mes"
                icon={<RefreshCw className="w-5 h-5" />}
                color="slate"
            />

            {/* Días Cama */}
            <KPICard
                title="Días Cama"
                value={stats.diasCamaOcupados}
                subtitle={`de ${stats.diasCamaDisponibles} disponibles`}
                icon={<TrendingUp className="w-5 h-5" />}
                color="blue"
            />
        </div>
    );
};

export default MinsalKPICards;
