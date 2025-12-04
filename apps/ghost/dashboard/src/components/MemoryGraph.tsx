import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

interface Node extends d3.SimulationNodeDatum {
    id: string;
    type: string;
    label: string;
    confidence?: number;
    source_path?: string;
}

interface Link extends d3.SimulationLinkDatum<Node> {
    source: string | Node;
    target: string | Node;
    weight: number;
}

export interface GraphData {
    nodes: Node[];
    edges: Link[];
}

export function MemoryGraph({ data, compact = false }: { data: GraphData; compact?: boolean }) {
    const svgRef = useRef<SVGSVGElement>(null);

    useEffect(() => {
        if (!svgRef.current || !data.nodes.length) return;

        // Compact mode: smaller dimensions, tighter physics
        const width = compact ? 300 : 800;
        const height = compact ? 220 : 600;

        // Clear previous
        d3.select(svgRef.current).selectAll('*').remove();

        const svg = d3.select(svgRef.current)
            .attr('viewBox', [0, 0, width, height])
            .attr('style', 'max-width: 100%; height: auto; background: transparent; border-radius: 12px;');

        // Simulation
        const simulation = d3.forceSimulation(data.nodes)
            .force('link', d3.forceLink(data.edges).id((d: any) => d.id).distance(compact ? 40 : 120))
            .force('charge', d3.forceManyBody().strength(compact ? -100 : -400))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collide', d3.forceCollide().radius(compact ? 15 : 30));

        // Draw lines
        const link = svg.append('g')
            .attr('stroke', '#999')
            .attr('stroke-opacity', 0.6)
            .selectAll('line')
            .data(data.edges)
            .join('line')
            .attr('stroke-width', (d) => Math.sqrt(d.weight * (compact ? 2 : 5)));

        // Add Glow Filter
        const defs = svg.append('defs');
        const filter = defs.append('filter')
            .attr('id', 'glow');
        filter.append('feGaussianBlur')
            .attr('stdDeviation', '2.5')
            .attr('result', 'coloredBlur');
        const feMerge = filter.append('feMerge');
        feMerge.append('feMergeNode').attr('in', 'coloredBlur');
        feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

        // Draw nodes
        const node = svg.append('g')
            .selectAll('g')
            .data(data.nodes)
            .join('g')
            .call(drag(simulation) as any);

        node.append('circle')
            .attr('r', (d) => {
                const base = d.type === 'query' ? 14 : 10;
                return compact ? base * 0.6 : base;
            })
            .attr('fill', (d) => colorByType(d.type))
            .attr('stroke', '#fff')
            .attr('stroke-width', compact ? 1.5 : 3)
            .style('cursor', (d) => d.type === 'file' ? 'pointer' : 'default')
            .style('filter', (d) => d.type === 'fact.session' ? 'url(#glow)' : 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))')
            .on('click', async (event, d) => {
                if (d.type === 'file') {
                    event.stopPropagation();
                    // Try to open via API first, then fallback to postMessage for overlay context
                    const filePath = (d as Node).source_path || d.label;
                    console.log('[Ghost][MemoryGraph] Opening file:', filePath);
                    try {
                        await fetch('http://localhost:4000/api/open-file', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ filePath })
                        });
                    } catch (error) {
                        console.error('[Ghost][MemoryGraph] Error opening file via API:', error);
                        // Fallback: send message to parent window (for overlay context)
                        if ((d as Node).source_path) {
                            window.parent.postMessage({
                                type: 'open-file',
                                path: (d as Node).source_path
                            }, '*');
                        }
                    }
                }
            })
            .on('mouseover', function (_event, d) {
                if ((d as Node).type === 'file') {
                    d3.select(this)
                        .attr('r', compact ? 8 : 12)
                        .attr('stroke-width', compact ? 2 : 4);
                }
            })
            .on('mouseout', function (_event, d) {
                if ((d as Node).type === 'file') {
                    d3.select(this)
                        .attr('r', compact ? 6 : 10)
                        .attr('stroke-width', compact ? 1.5 : 3);
                }
            });

        // Add icons or text inside nodes? Maybe just tooltips.
        node.append('title')
            .text((d: any) => {
                let text = `${d.label} (${d.type})`;
                if (d.source_path) {
                    text += `\nSource: ${d.source_path}`;
                }
                if (d.type === 'file') {
                    text += '\n(Click to open file)';
                }
                return text;
            });

        // Labels - Hide in compact mode unless it's the query or very few nodes
        if (!compact || data.nodes.length < 5) {
            node.append('text')
                .attr('dx', compact ? 10 : 18)
                .attr('dy', compact ? 3 : 5)
                .text(d => {
                    // Show just filename for file nodes, full label for others
                    if (d.type === 'file' && d.label.includes('/')) {
                        return d.label.split('/').pop() || d.label;
                    }
                    return d.label;
                })
                .style('font-size', compact ? '10px' : '13px')
                .style('font-family', '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif')
                .style('font-weight', '500')
                .style('fill', compact ? '#FFF' : '#1D1D1F') // White text in compact overlay
                .style('stroke', 'none')
                .style('pointer-events', 'none');
        }

        simulation.on('tick', () => {
            link
                .attr('x1', (d: any) => d.source.x)
                .attr('y1', (d: any) => d.source.y)
                .attr('x2', (d: any) => d.target.x)
                .attr('y2', (d: any) => d.target.y);

            node
                .attr('transform', (d: any) => `translate(${d.x},${d.y})`);
        });

        function drag(simulation: any) {
            function dragstarted(event: any) {
                if (!event.active) simulation.alphaTarget(0.3).restart();
                event.subject.fx = event.subject.x;
                event.subject.fy = event.subject.y;
            }

            function dragged(event: any) {
                event.subject.fx = event.x;
                event.subject.fy = event.y;
            }

            function dragended(event: any) {
                if (!event.active) simulation.alphaTarget(0);
                event.subject.fx = null;
                event.subject.fy = null;
            }

            return d3.drag()
                .on('start', dragstarted)
                .on('drag', dragged)
                .on('end', dragended);
        }

        function colorByType(type: string) {
            switch (type) {
                case 'query': return '#007AFF'; // Apple Blue
                case 'memory': return '#34C759'; // Apple Green
                case 'fact.session': return '#FFD60A'; // Apple Yellow/Gold for MAKER session memories
                case 'entity': return '#FF9500'; // Apple Orange
                case 'file': return '#AF52DE'; // Apple Purple
                default: return '#8E8E93'; // Apple Gray
            }
        }

    }, [data, compact]);

    return <svg ref={svgRef} />;
}
