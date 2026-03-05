import React from 'react'

interface SwitchProps {
    checked: boolean
    onChange: (checked: boolean) => void
    disabled?: boolean
}

export function Switch({ checked, onChange, disabled = false }: SwitchProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={`
                relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background
                ${checked ? 'bg-primary' : 'bg-muted'}
                ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
            `}
        >
            <span
                aria-hidden="true"
                className={`
                    pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow ring-0 transition duration-200 ease-in-out
                    ${checked ? 'translate-x-4' : 'translate-x-0'}
                `}
            />
        </button>
    )
}
