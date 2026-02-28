import React from 'react'
import { cn } from '../../utils'

interface ProfitProps extends React.HTMLAttributes<HTMLSpanElement> {
    value: number | string
    prefix?: string
    suffix?: string
    colorful?: boolean
}

export function ProfitBadge({ value, prefix = '', suffix = '', className, ...props }: ProfitProps) {
    const numValue = typeof value === 'string' ? parseFloat(value.replace(/,/g, '')) : value;
    const isPositive = numValue >= 0;

    return (
        <span
            className={cn(
                "text-xs font-bold px-1.5 py-0.5 rounded",
                isPositive ? "bg-rise/10 text-rise" : "bg-fall/10 text-fall",
                className
            )}
            {...props}
        >
            {isPositive && numValue > 0 ? '+' : ''}{prefix}{value}{suffix}
        </span>
    )
}

export function ProfitText({ value, prefix = '', suffix = '', className, colorful = true, ...props }: ProfitProps) {
    const numValue = typeof value === 'string' ? parseFloat(value.replace(/,/g, '')) : value;
    const isPositive = numValue >= 0;

    return (
        <span
            className={cn(
                "font-bold",
                colorful && (isPositive ? "text-rise" : "text-fall"),
                className
            )}
            {...props}
        >
            {colorful && isPositive && numValue > 0 ? '+' : ''}{prefix}{typeof value === 'number' ? value.toLocaleString() : value}{suffix}
        </span>
    )
}
