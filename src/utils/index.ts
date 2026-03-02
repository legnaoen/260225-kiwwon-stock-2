import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export const parseNumber = (val: any): number => {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    const clean = String(val).replace(/,/g, '').replace(/[^\d.-]/g, '');
    const num = Number(clean);
    return isNaN(num) ? 0 : num;
}

export const formatTargetDate = (dateStr: string) => {
    if (!dateStr) return '';
    try {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        const [y, m, d] = dateStr.split('-');
        const target = new Date(Number(y), Number(m) - 1, Number(d));

        const diffTime = target.getTime() - today.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays >= 0 && diffDays <= 10) {
            return `🔔 ${diffDays}d`;
        }

        if (target.getFullYear() === now.getFullYear()) {
            return `🔔 ${m}-${d}`;
        }

        return `🔔 ${dateStr}`;
    } catch (e) {
        return `🔔 ${dateStr}`;
    }
}
