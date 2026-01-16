/**
 * SpecialtyBreakdownTable Component
 * Table showing statistics breakdown by medical specialty
 */

import React from 'react';
import { SpecialtyStats } from '@/types/minsalTypes';

interface SpecialtyBreakdownTableProps {
    data: SpecialtyStats[];
}

export const SpecialtyBreakdownTable: React.FC<SpecialtyBreakdownTableProps> = ({
    data,
}) => {
    if (data.length === 0) {
        return (
            <div className="text-center py-8 text-slate-400">
                No hay datos de especialidades para el período seleccionado.
            </div>
        );
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="bg-slate-100">
                        <th className="text-left px-4 py-3 font-semibold text-slate-700 rounded-tl-lg">
                            Especialidad
                        </th>
                        <th className="text-center px-4 py-3 font-semibold text-slate-700">
                            Pacientes (Días-Cama)
                        </th>
                        <th className="text-center px-4 py-3 font-semibold text-slate-700">
                            Egresos
                        </th>
                        <th className="text-center px-4 py-3 font-semibold text-slate-700">
                            Fallecidos
                        </th>
                        <th className="text-center px-4 py-3 font-semibold text-slate-700">
                            Traslados
                        </th>
                        <th className="text-center px-4 py-3 font-semibold text-slate-700">
                            Contribución
                        </th>
                        <th className="text-center px-4 py-3 font-semibold text-slate-700">
                            Mortalidad
                        </th>
                        <th className="text-center px-4 py-3 font-semibold text-slate-700 rounded-tr-lg">
                            Estada Media
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {data.map((row, index) => (
                        <tr
                            key={row.specialty}
                            className={`border-b border-slate-100 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'
                                } hover:bg-sky-50 transition-colors`}
                        >
                            <td className="px-4 py-3 font-medium text-slate-800">
                                {row.specialty || 'Sin Especialidad'}
                            </td>
                            <td className="px-4 py-3 text-center">
                                <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-1 bg-sky-100 text-sky-700 rounded-full font-semibold">
                                    {row.diasOcupados}
                                </span>
                            </td>
                            <td className="px-4 py-3 text-center text-slate-600">
                                {row.egresos}
                            </td>
                            <td className="px-4 py-3 text-center">
                                {row.fallecidos > 0 ? (
                                    <span className="text-red-600 font-medium">{row.fallecidos}</span>
                                ) : (
                                    <span className="text-slate-400">0</span>
                                )}
                            </td>
                            <td className="px-4 py-3 text-center">
                                {row.traslados > 0 ? (
                                    <span className="text-amber-600 font-medium">{row.traslados}</span>
                                ) : (
                                    <span className="text-slate-400">0</span>
                                )}
                            </td>
                            <td className="px-4 py-3 text-center">
                                <div className="flex items-center gap-2">
                                    <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-sky-500 rounded-full"
                                            style={{ width: `${Math.min(row.contribucionRelativa, 100)}%` }}
                                        />
                                    </div>
                                    <span className="text-xs font-medium text-slate-600 min-w-[3rem]">
                                        {row.contribucionRelativa.toFixed(1)}%
                                    </span>
                                </div>
                            </td>
                            <td className="px-4 py-3 text-center">
                                <span
                                    className={`font-medium ${row.tasaMortalidad > 5
                                        ? 'text-red-600'
                                        : row.tasaMortalidad > 0
                                            ? 'text-orange-600'
                                            : 'text-slate-400'
                                        }`}
                                >
                                    {row.tasaMortalidad.toFixed(1)}%
                                </span>
                            </td>
                            <td className="px-4 py-3 text-center text-slate-600">
                                {row.promedioDiasEstada.toFixed(1)} días
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default SpecialtyBreakdownTable;
