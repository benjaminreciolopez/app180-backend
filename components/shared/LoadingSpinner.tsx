import React from 'react';

interface LoadingSpinnerProps {
    className?: string;
    fullPage?: boolean;
    showText?: boolean;
}

export const LoadingSpinner = ({ className = "", fullPage = false, showText = true }: LoadingSpinnerProps) => {
    const spinner = (
        <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
            {showText && <p className="text-sm font-medium text-gray-500 animate-pulse">Cargando datos...</p>}
        </div>
    );

    if (fullPage) {
        return (
            <div className="flex items-center justify-center min-h-[60vh] w-full">
                {spinner}
            </div>
        );
    }

    return spinner;
};
