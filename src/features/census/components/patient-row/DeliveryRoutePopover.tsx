/**
 * DeliveryRoutePopover - Registro de Vía del Parto
 * Shows a subtle icon next to diagnosis for Ginecobstetricia patients
 * that opens a popover to record delivery route (Vaginal/Cesárea) and date.
 * Uses React Portal to escape ANY parent clipping and transform constraints.
 */

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { HeartPulse, X, Trash2, Check } from 'lucide-react';
import clsx from 'clsx';

type DeliveryRoute = 'Vaginal' | 'Cesárea';

interface DeliveryRoutePopoverProps {
    deliveryRoute?: DeliveryRoute;
    deliveryDate?: string;
    onSave: (route: DeliveryRoute | undefined, date: string | undefined) => void;
    disabled?: boolean;
}

export const DeliveryRoutePopover: React.FC<DeliveryRoutePopoverProps> = ({
    deliveryRoute,
    deliveryDate,
    onSave,
    disabled = false
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [selectedRoute, setSelectedRoute] = useState<DeliveryRoute | undefined>(deliveryRoute);
    const [selectedDate, setSelectedDate] = useState<string>(deliveryDate || '');
    const [popoverPos, setPopoverPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
    const popoverRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);

    // Sync local state with props when they change (State derivation pattern)
    const [prevProps, setPrevProps] = useState({ route: deliveryRoute, date: deliveryDate });
    if (deliveryRoute !== prevProps.route || deliveryDate !== prevProps.date) {
        setSelectedRoute(deliveryRoute);
        setSelectedDate(deliveryDate || '');
        setPrevProps({ route: deliveryRoute, date: deliveryDate });
    }

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                popoverRef.current && !popoverRef.current.contains(event.target as Node) &&
                buttonRef.current && !buttonRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    // Close on scroll (outside of popover)
    useEffect(() => {
        if (!isOpen) return;
        const handleScroll = (e: Event) => {
            if (popoverRef.current && popoverRef.current.contains(e.target as Node)) {
                return;
            }
            setIsOpen(false);
        };
        window.addEventListener('scroll', handleScroll, true);
        return () => window.removeEventListener('scroll', handleScroll, true);
    }, [isOpen]);

    const togglePopover = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();

        if (disabled) return;

        if (!isOpen && buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            setPopoverPos({
                top: rect.bottom + 4,
                left: Math.max(8, rect.left - 180)
            });
        }
        setIsOpen(!isOpen);
    };

    const handleSave = () => {
        onSave(selectedRoute, selectedDate || undefined);
        setIsOpen(false);
    };

    const handleClear = () => {
        setSelectedRoute(undefined);
        setSelectedDate('');
        onSave(undefined, undefined);
        setIsOpen(false);
    };

    const hasData = !!deliveryRoute;

    const getIconColor = () => {
        if (!hasData) return 'text-slate-300 hover:text-slate-400';
        if (deliveryRoute === 'Vaginal') return 'text-pink-500';
        if (deliveryRoute === 'Cesárea') return 'text-blue-500';
        return 'text-slate-400';
    };

    return (
        <div className="inline-flex items-center">
            <button
                type="button"
                ref={buttonRef}
                onClick={togglePopover}
                disabled={disabled}
                className={clsx(
                    "p-0.5 rounded transition-all duration-200",
                    disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-slate-100",
                    getIconColor()
                )}
                title={hasData
                    ? `${deliveryRoute} - ${deliveryDate ? new Date(deliveryDate).toLocaleDateString('es-CL') : 'Sin fecha'}`
                    : 'Vía del parto'
                }
            >
                <HeartPulse size={14} />
            </button>

            {/* Popover - Compacted size and fonts */}
            {isOpen && createPortal(
                <div
                    ref={popoverRef}
                    className="fixed w-52 bg-white rounded-xl shadow-2xl border border-slate-200 z-[9999] animate-in fade-in slide-in-from-top-1 duration-150"
                    style={{
                        top: popoverPos.top,
                        left: popoverPos.left,
                        position: 'fixed'
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-slate-50/50 rounded-t-xl">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            Vía del Parto
                        </span>
                        <button
                            type="button"
                            onClick={() => setIsOpen(false)}
                            className="p-0.5 text-slate-400 hover:text-slate-600 rounded transition-colors"
                        >
                            <X size={12} />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-3 space-y-3">
                        {/* Route Selection */}
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setSelectedRoute('Vaginal')}
                                className={clsx(
                                    "px-2 py-1.5 rounded-lg border text-[11px] font-bold transition-all flex items-center justify-center gap-1",
                                    selectedRoute === 'Vaginal'
                                        ? "border-pink-200 bg-pink-50 text-pink-700 shadow-sm"
                                        : "border-slate-100 bg-slate-50 text-slate-500 hover:border-slate-200"
                                )}
                            >
                                {selectedRoute === 'Vaginal' && <Check size={10} />}
                                Vaginal
                            </button>
                            <button
                                type="button"
                                onClick={() => setSelectedRoute('Cesárea')}
                                className={clsx(
                                    "px-2 py-1.5 rounded-lg border text-[11px] font-bold transition-all flex items-center justify-center gap-1",
                                    selectedRoute === 'Cesárea'
                                        ? "border-blue-200 bg-blue-50 text-blue-700 shadow-sm"
                                        : "border-slate-100 bg-slate-50 text-slate-500 hover:border-slate-200"
                                )}
                            >
                                {selectedRoute === 'Cesárea' && <Check size={10} />}
                                Cesárea
                            </button>
                        </div>

                        {/* Date Selection */}
                        <div className="space-y-1">
                            <label className="block text-[10px] font-medium text-slate-400 px-0.5">
                                Fecha
                            </label>
                            <input
                                type="date"
                                value={selectedDate}
                                onChange={(e) => setSelectedDate(e.target.value)}
                                className="w-full px-2 py-1 text-[12px] bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-medical-500/10 focus:border-medical-500 transition-all font-medium"
                            />
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2 pt-1">
                            {hasData && (
                                <button
                                    type="button"
                                    onClick={handleClear}
                                    className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                    title="Limpiar"
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={!selectedRoute}
                                className={clsx(
                                    "flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all",
                                    selectedRoute
                                        ? "bg-medical-600 text-white hover:bg-medical-500 shadow-sm"
                                        : "bg-slate-100 text-slate-400 cursor-not-allowed"
                                )}
                            >
                                Guardar
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};
