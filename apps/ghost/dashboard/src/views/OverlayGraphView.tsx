import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { fetchCommandById } from '../api';
import type { Command } from '../types';
import { MemoryGraph, type GraphData } from '../components/MemoryGraph';

export function OverlayGraphView() {
    const { commandId } = useParams<{ commandId: string }>();
    const [command, setCommand] = useState<Command | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!commandId) return;
        const load = async () => {
            try {
                setLoading(true);
                const data = await fetchCommandById(commandId);
                setCommand(data);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [commandId]);

    const graphData = useMemo<GraphData | null>(() => {
        if (!command) return null;

        const nodes: any[] = [];
        const edges: any[] = [];

        // Central node: The Command
        nodes.push({
            id: 'root',
            type: 'query',
            label: 'Command',
            confidence: 1
        });

        // Memory nodes
        if (command.memories_used) {
            command.memories_used.forEach((memory) => {
                if (memory.metadata?.maker_verified) return;

                const isFile = !!memory.metadata?.path;
                const label = isFile
                    ? memory.metadata!.path.split('/').pop()
                    : (memory.summary || memory.id).slice(0, 20) + '...';

                nodes.push({
                    id: memory.id,
                    type: isFile ? 'file' : (memory.type || 'memory'),
                    label: isFile ? memory.metadata!.path : label,
                    confidence: memory.score,
                    source_path: memory.metadata?.path
                });

                edges.push({
                    source: 'root',
                    target: memory.id,
                    weight: memory.score
                });
            });
        }

        return { nodes, edges };
    }, [command]);

    if (loading) return null;
    if (!command || !graphData) return null;

    return (
        <div style={{
            background: 'rgba(28, 28, 30, 0.85)', // Darker, more opaque for small popup
            backdropFilter: 'blur(20px) saturate(180%)',
            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
            overflow: 'hidden',
            borderRadius: '12px',
            border: '1px solid rgba(255,255,255,0.15)',
            boxShadow: '0 12px 24px rgba(0, 0, 0, 0.3)',
            display: 'flex',
            flexDirection: 'column'
        }}>
            <div style={{
                padding: '12px 16px',
                borderBottom: '1px solid rgba(255,255,255,0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
            }}>
                <div style={{
                    color: 'white',
                    fontSize: '12px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                }}>
                    <span style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: '#0A84FF',
                        boxShadow: '0 0 8px rgba(10, 132, 255, 0.6)'
                    }} />
                    Memory Graph
                </div>
            </div>
            <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <MemoryGraph data={graphData} compact={true} />
            </div>
        </div>
    );
}
