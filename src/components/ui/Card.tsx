import React from 'react'
import { cn } from '../../utils'

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn("bg-background border border-border rounded-xl shadow-sm", className)}
            {...props}
        />
    )
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return <div className={cn("px-5 py-4 flex flex-col gap-2", className)} {...props} />
}
