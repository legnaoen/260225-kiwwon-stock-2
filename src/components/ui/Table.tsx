import React from 'react'
import { cn } from '../../utils'

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
    return (
        <div className="w-full overflow-auto">
            <table className={cn("w-full table-fixed text-left text-sm border-collapse tabular-nums", className)} {...props} />
        </div>
    )
}

export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
    return <thead className={cn("bg-muted/30 border-b border-border sticky top-0 z-10", className)} {...props} />
}

export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
    return <tr className={cn("hover:bg-muted/40 transition-colors group border-b border-border", className)} {...props} />
}

export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
    return <th className={cn("px-4 py-3 font-semibold text-xs text-muted-foreground", className)} {...props} />
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
    return <tbody className={cn("divide-y divide-border", className)} {...props} />
}

export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
    return <td className={cn("px-4 py-2.5", className)} {...props} />
}
