/**
 * Resizable Table Header Component
 * Provides drag handles for resizing table columns
 */

import React, { useRef, useCallback } from 'react';
import clsx from 'clsx';

interface ResizableHeaderProps {
    children: React.ReactNode;
    width: number;
    isEditMode: boolean;
    onResize: (newWidth: number) => void;
    className?: string;
    title?: string;
    minWidth?: number;
    maxWidth?: number;
}

export const ResizableHeader: React.FC<ResizableHeaderProps> = ({
    children,
    width,
    isEditMode,
    onResize,
    className = '',
    title,
    minWidth = 24,
    maxWidth = 400
}) => {
    const headerRef = useRef<HTMLTableCellElement>(null);
    const startXRef = useRef(0);
    const startWidthRef = useRef(0);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (!isEditMode) return;

        e.preventDefault();
        startXRef.current = e.clientX;
        startWidthRef.current = width;

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const delta = moveEvent.clientX - startXRef.current;
            const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidthRef.current + delta));
            onResize(newWidth);
        };

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }, [isEditMode, width, onResize, minWidth, maxWidth]);

    return (
        <th
            ref={headerRef}
            className={clsx(className, 'relative')}
            style={{ width: `${width}px`, maxWidth: `${width}px` }}
            title={title}
        >
            {children}

            {/* Resize handle */}
            {isEditMode && (
                <div
                    className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-400/50 bg-blue-300/30 transition-colors z-30"
                    onMouseDown={handleMouseDown}
                />
            )}
        </th>
    );
};
