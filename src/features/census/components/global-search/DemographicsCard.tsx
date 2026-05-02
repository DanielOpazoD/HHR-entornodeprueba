/**
 * DemographicsCard
 *
 * Displays the patient identity header for global search details.
 */

import React from 'react';
import { User } from 'lucide-react';
import type { MasterPatient } from '@/types/domain/patientMaster';

interface DemographicsCardProps {
  patient: MasterPatient;
}

export const DemographicsCard: React.FC<DemographicsCardProps> = ({ patient }) => (
  <div className="bg-white rounded-lg border border-slate-200 px-3 py-2 mb-2">
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-full bg-medical-100 flex items-center justify-center">
        <User size={16} className="text-medical-600" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-bold text-slate-800">{patient.fullName}</h3>
        <span className="text-xs font-mono text-slate-500">{patient.rut}</span>
      </div>
      {patient.vitalStatus === 'Fallecido' && (
        <span className="ml-auto text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-full px-2.5 py-0.5">
          Fallecido
        </span>
      )}
    </div>
  </div>
);
