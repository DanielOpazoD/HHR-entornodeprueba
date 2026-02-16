import React from 'react';
import { Phone, MessageCircle } from 'lucide-react';
import { ShiftStaffMember } from '@/types';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntime';

interface StaffCardProps {
  member: ShiftStaffMember;
}

export const StaffCard: React.FC<StaffCardProps> = ({ member }) => {
  const handleCall = () => {
    defaultBrowserWindowRuntime.open(`tel:${member.phone}`, '_self');
  };

  const handleWhatsApp = () => {
    defaultBrowserWindowRuntime.open(member.whatsappUrl, '_blank');
  };

  return (
    <div className="bg-white border rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow">
      {/* Role */}
      <div className="text-xs font-medium text-blue-600 uppercase tracking-wide mb-1">
        {member.role}
      </div>

      {/* Name */}
      <div className="font-semibold text-gray-900 mb-2">{member.name}</div>

      {/* Phone */}
      <div className="text-sm text-gray-600 mb-3">📱 {member.phone}</div>

      {/* Notes */}
      {member.notes && (
        <div className="text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded mb-3">
          ⏰ {member.notes}
        </div>
      )}

      {/* Replacement */}
      {member.replacement && (
        <div className="border-t pt-2 mt-2">
          <div className="text-xs text-gray-500 mb-1">Luego:</div>
          <div className="text-sm font-medium">{member.replacement.name}</div>
          <div className="text-xs text-gray-600">{member.replacement.phone}</div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2 mt-3">
        <button
          onClick={handleCall}
          className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors text-sm"
        >
          <Phone className="w-4 h-4" />
          Llamar
        </button>
        <button
          onClick={handleWhatsApp}
          className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors text-sm"
        >
          <MessageCircle className="w-4 h-4" />
          WhatsApp
        </button>
      </div>
    </div>
  );
};
