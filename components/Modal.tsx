import React, { useEffect } from 'react';

interface ModalProps {
    open: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    maxWidth?: string; // e.g. 'max-w-lg', 'max-w-4xl'
}

const Modal: React.FC<ModalProps> = ({ open, onClose, title, children, maxWidth = 'max-w-lg' }) => {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fade-in">
            <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full ${maxWidth} max-h-[90vh] flex flex-col transition-colors duration-200`}>
                {/* Header */}
                <div className="flex justify-between items-center px-6 py-4 border-b dark:border-gray-700 shrink-0">
                    <h2 className="text-xl font-semibold text-gray-800 dark:text-white">
                        {title}
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                    >
                        <i className="fas fa-times text-lg"></i>
                    </button>
                </div>

                {/* Content - Scrollable */}
                <div className="p-6 overflow-y-auto">
                    {children}
                </div>
            </div>
        </div>
    );
};

export default Modal;
