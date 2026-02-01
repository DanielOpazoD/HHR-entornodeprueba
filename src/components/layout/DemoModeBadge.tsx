/**
 * DemoModeBadge - Demo mode indicator component
 * Extracted from Navbar.tsx to remove IIFE pattern with hooks.
 */

import React from 'react';
import { useDemoMode } from '@/context/DemoModeContext';

export const DemoModeBadge: React.FC = () => {
    const { isActive } = useDemoMode();

    if (!isActive) return null;

    return (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/20 border border-amber-500/50 rounded-full text-amber-200 text-xs font-bold uppercase tracking-wider animate-pulse">
            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
            MODO DEMO
        </div>
    );
};
