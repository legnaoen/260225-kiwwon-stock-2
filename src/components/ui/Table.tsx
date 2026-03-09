import React from 'react'
import { cn } from '../../utils'

export const Table = React.forwardRef<HTMLTableElement, React.TableHTMLAttributes<HTMLTableElement>>(
    ({ className, ...props }, ref) => (
        <div className="w-full overflow-auto">
            <table ref={ref} className={cn("w-full table-fixed text-left text-sm border-collapse tabular-nums", className)} {...props} />
        </div>
    )
)
Table.displayName = "Table"

export const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
    ({ className, ...props }, ref) => (
        <thead ref={ref} className={cn("bg-muted/30 border-b border-border sticky top-0 z-10", className)} {...props} />
    )
)
TableHeader.displayName = "TableHeader"

export const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
    ({ className, ...props }, ref) => (
        <tr ref={ref} className={cn("hover:bg-muted/40 transition-colors group border-b border-border", className)} {...props} />
    )
)
TableRow.displayName = "TableRow"

export const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
    ({ className, ...props }, ref) => (
        <th ref={ref} className={cn("px-4 py-3 font-semibold text-xs text-muted-foreground", className)} {...props} />
    )
)
TableHead.displayName = "TableHead"

export const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
    ({ className, ...props }, ref) => (
        <tbody ref={ref} className={cn("divide-y divide-border", className)} {...props} />
    )
)
TableBody.displayName = "TableBody"

export const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
    ({ className, ...props }, ref) => (
        <td ref={ref} className={cn("px-4 py-2.5", className)} {...props} />
    )
)
TableCell.displayName = "TableCell"
