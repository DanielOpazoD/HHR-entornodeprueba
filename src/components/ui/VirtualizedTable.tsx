/**
 * VirtualizedTable Component
 * Renders only visible rows for better performance with large datasets.
 * Uses @tanstack/react-virtual for virtualization.
 */

import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

interface VirtualizedTableProps<T> {
    /** Data items to render */
    items: T[];
    /** Height of each row in pixels */
    rowHeight: number;
    /** Maximum height of the table container */
    maxHeight: number;
    /** Render function for table header */
    renderHeader: () => React.ReactNode;
    /** Render function for each row */
    renderRow: (item: T, index: number) => React.ReactNode;
    /** Optional class name for the container */
    className?: string;
    /** Overscan - number of items to render above/below visible area */
    overscan?: number;
}

export function VirtualizedTable<T>({
    items,
    rowHeight,
    maxHeight,
    renderHeader,
    renderRow,
    className = '',
    overscan = 5
}: VirtualizedTableProps<T>) {
    const parentRef = useRef<HTMLDivElement>(null);

    const virtualizer = useVirtualizer({
        count: items.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => rowHeight,
        overscan
    });

    const virtualItems = virtualizer.getVirtualItems();
    const totalSize = virtualizer.getTotalSize();

    return (
        <div className={`bg-white rounded-xl shadow-sm border border-slate-200 ${className}`}>
            <div
                ref={parentRef}
                className="overflow-auto scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent"
                style={{ maxHeight }}
            >
                <table className="w-full text-left border-collapse relative">
                    <thead>
                        {renderHeader()}
                    </thead>
                    <tbody
                        style={{
                            height: `${totalSize}px`,
                            width: '100%',
                            position: 'relative'
                        }}
                    >
                        {virtualItems.map((virtualRow) => {
                            const item = items[virtualRow.index];
                            return (
                                <tr
                                    key={virtualRow.key}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: '100%',
                                        height: `${virtualRow.size}px`,
                                        transform: `translateY(${virtualRow.start}px)`
                                    }}
                                >
                                    {renderRow(item, virtualRow.index)}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default VirtualizedTable;
