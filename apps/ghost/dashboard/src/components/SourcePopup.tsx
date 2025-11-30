import { useEffect, useState } from 'react';
import type { MemoryReference } from '../types';
import './SourcePopup.css';

interface SourcePopupProps {
    sources: MemoryReference[];
    onClose: () => void;
    onSourceClick?: (source: MemoryReference) => void;
}

export function SourcePopup({ sources, onClose, onSourceClick }: SourcePopupProps) {
    const [collapsed, setCollapsed] = useState(false);

    useEffect(() => {
        // Auto-collapse after 8 seconds
        const timer = setTimeout(() => {
            setCollapsed(true);
        }, 8000);

        return () => clearTimeout(timer);
    }, []);

    const getFileType = (source: MemoryReference): string => {
        const ext = source.metadata?.name?.split('.').pop()?.toLowerCase();
        return ext || 'txt';
    };

    const handleSourceClick = (source: MemoryReference) => {
        if (onSourceClick) {
            onSourceClick(source);
        } else if (source.metadata?.path) {
            // Default: try to open file via shell
            window.open(`file://${source.metadata.path}`);
        }
    };

    return (
        <div className={`source-popup ${collapsed ? 'collapsed' : ''}`}>
            <div className="popup-header">
                <div className="popup-header-content">
                    <span className="popup-title">Found in</span>
                    <span className="source-count">{sources.length} source{sources.length > 1 ? 's' : ''}</span>
                </div>
                <button className="close-btn" onClick={onClose}>×</button>
            </div>

            <div className="sources-list">
                {sources.map((source) => (
                    <div
                        key={source.id}
                        className="source-card"
                        onClick={() => handleSourceClick(source)}
                    >
                        <div className={`confidence-bar ${source.score > 0.7 ? 'high' : source.score > 0.4 ? 'medium' : 'low'}`} />
                        <div className="source-header">
                            <div className={`file-type ${getFileType(source)}`}>
                                {getFileType(source)}
                            </div>
                            <span className="source-title">
                                {source.metadata?.name || source.id}
                            </span>
                            {source.metadata?.modified && (
                                <span className="source-date">
                                    {new Date(source.metadata.modified).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                </span>
                            )}
                        </div>
                        <div className="source-snippet">{source.summary}</div>
                    </div>
                ))}
            </div>

            <div className="popup-footer">
                <button className="footer-btn" onClick={onClose}>Dismiss</button>
            </div>
        </div>
    );
}
