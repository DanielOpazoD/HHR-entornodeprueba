import React, { useCallback, useRef, useState } from 'react';
import { TransferRequest, TRANSFER_STATUS_CONFIG, TransferStatus } from '@/types/transfers';
import { ChevronDown, Clock, MessageSquare, User, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { usePortalPopoverRuntime } from '@/hooks/usePortalPopoverRuntime';
import {
  resolveTransferStatusDropdownPosition,
  TRANSFER_STATUS_OPTIONS,
} from '@/features/transfers/controllers/transferStatusInteractionController';

interface TransferStatusInteractionProps {
  transfer: TransferRequest;
  onStatusChange: (status: TransferStatus) => Promise<void>;
  onDeleteHistoryEntry?: (historyIndex: number) => Promise<void>;
}

export const TransferStatusInteraction: React.FC<TransferStatusInteractionProps> = ({
  transfer,
  onStatusChange,
  onDeleteHistoryEntry,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const config = TRANSFER_STATUS_CONFIG[transfer.status] || {
    label: transfer.status,
    color: 'text-gray-700',
    bgColor: 'bg-gray-100',
  };

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
  }, []);

  const resolveDropdownPosition = useCallback(() => {
    if (!buttonRef.current) {
      return null;
    }

    const rect = buttonRef.current.getBoundingClientRect();
    return resolveTransferStatusDropdownPosition({
      buttonRect: rect,
      viewportHeight: window.innerHeight,
    });
  }, []);

  const { position: dropdownPos, updatePosition } = usePortalPopoverRuntime({
    isOpen,
    anchorRef: buttonRef,
    popoverRef: dropdownRef,
    initialPosition: { top: 0, left: 0, dropUp: false },
    resolvePosition: resolveDropdownPosition,
    onClose: closeDropdown,
  });

  const toggleDropdown = () => {
    if (!isOpen) {
      updatePosition();
    }
    setIsOpen(previous => !previous);
  };

  const handleStatusClick = async (newStatus: TransferStatus) => {
    if (newStatus === transfer.status) return;
    await onStatusChange(newStatus);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      {/* Main Badge Button */}
      <button
        ref={buttonRef}
        onClick={toggleDropdown}
        className={clsx(
          'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all border shadow-sm',
          config.bgColor,
          config.color,
          'hover:scale-105 active:scale-95',
          isOpen ? 'ring-2 ring-offset-1 ring-blue-400' : 'border-transparent'
        )}
      >
        <span>{config.label}</span>
        <ChevronDown size={14} className={clsx('transition-transform', isOpen && 'rotate-180')} />
      </button>

      {/* Dropdown Menu - Fixed position to escape overflow container */}
      {isOpen && (
        <div
          ref={dropdownRef}
          className="fixed w-72 bg-white rounded-xl shadow-2xl border border-slate-200 z-[9999] overflow-hidden animate-in fade-in duration-200"
          style={{
            top: dropdownPos.dropUp ? 'auto' : dropdownPos.top,
            bottom: dropdownPos.dropUp ? `${window.innerHeight - dropdownPos.top + 8}px` : 'auto',
            left: dropdownPos.left,
          }}
        >
          <div className="p-3 bg-slate-50 border-b border-slate-100">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Clock size={12} /> Cambiar Estado
            </h4>
          </div>

          {/* Status Options */}
          <div className="p-2 grid grid-cols-2 gap-2">
            {TRANSFER_STATUS_OPTIONS.map(status => {
              const optConfig = TRANSFER_STATUS_CONFIG[status];
              const isCurrent = transfer.status === status;
              return (
                <button
                  key={status}
                  onClick={() => handleStatusClick(status)}
                  className={clsx(
                    'px-2 py-1.5 rounded-lg text-xs font-medium text-left transition-colors',
                    isCurrent
                      ? `${optConfig.bgColor} ${optConfig.color} ring-1 ring-inset ring-current`
                      : 'hover:bg-slate-50 text-slate-600'
                  )}
                >
                  {isCurrent && <span className="mr-1">●</span>}
                  {optConfig.label}
                </button>
              );
            })}
          </div>

          {/* History Section */}
          <div className="bg-slate-50/50 p-3 border-t border-slate-100">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Clock size={12} /> Historial de Cambios
            </h4>
            <div className="space-y-3 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
              {transfer.statusHistory
                .slice()
                .reverse()
                .map((change, idx) => (
                  <div key={idx} className="relative pl-4 border-l-2 border-slate-200 py-0.5">
                    <div className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-slate-300 border border-white" />
                    <div className="flex justify-between items-start">
                      <p className="text-[11px] font-bold text-slate-700">
                        {TRANSFER_STATUS_CONFIG[change.to]?.label || change.to}
                      </p>
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] text-slate-400">
                          {new Date(change.timestamp).toLocaleString('es-CL', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        {onDeleteHistoryEntry && transfer.statusHistory.length > 1 && (
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              // Get actual index (we're iterating reversed)
                              const actualIdx = transfer.statusHistory.length - 1 - idx;
                              onDeleteHistoryEntry(actualIdx);
                            }}
                            className="p-0.5 text-slate-300 hover:text-red-400 rounded transition-colors opacity-50 hover:opacity-100"
                            title="Eliminar este registro"
                          >
                            <Trash2 size={10} />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <User size={10} className="text-slate-400" />
                      <span className="text-[9px] text-slate-500 font-medium">
                        {change.userId.split('@')[0]}
                      </span>
                    </div>
                    {change.notes && (
                      <div className="mt-1 flex gap-1 items-start bg-white p-1.5 rounded border border-slate-100 shadow-sm">
                        <MessageSquare size={10} className="text-slate-400 mt-0.5 shrink-0" />
                        <p className="text-[10px] text-slate-600 leading-tight italic">
                          &quot;{change.notes}&quot;
                        </p>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
