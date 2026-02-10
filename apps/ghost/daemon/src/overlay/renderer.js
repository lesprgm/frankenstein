const { ipcRenderer } = require('electron');

const popup = document.getElementById('popup');
const sourcesList = document.getElementById('sources-list');
const sourceCount = document.getElementById('source-count');
const stateBadge = document.getElementById('state-badge');
const closeBtn = document.getElementById('close-btn');
const responseContainer = document.getElementById('response-container');
const responseText = document.getElementById('response-text');
const choicesContainer = document.getElementById('choices-container');
const choicesList = document.getElementById('choices-list');
const actionsContainer = document.getElementById('actions-container');
const actionsList = document.getElementById('actions-list');
const dismissBtn = document.getElementById('dismiss-btn');
const toast = document.getElementById('toast');
const toastTitle = document.getElementById('toast-title');
const toastBody = document.getElementById('toast-body');
let toastTimeout = null;
let resizeTimeout = null;
let currentCommandId = null;
let currentActions = [];
let currentChoices = [];

function requestOverlayResize(delay = 50) {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        const height = document.body.scrollHeight;
        ipcRenderer.send('ghost/overlay/resize', height);
    }, delay);
}

function getFileType(source) {
    if (source.metadata && source.metadata.name) {
        const parts = source.metadata.name.split('.');
        if (parts.length > 1) {
            return parts.pop().toLowerCase();
        }
    }
    return 'txt';
}

function renderSources(sources) {
    sourcesList.innerHTML = '';
    sourceCount.textContent = `${sources.length} source${sources.length !== 1 ? 's' : ''}`;
    sourceCount.style.display = sources.length > 0 ? 'inline-flex' : 'none';

    sources.forEach(source => {
        const card = document.createElement('div');
        card.className = 'source-card';

        const score = source.score || 0;
        const confidenceClass = score > 0.7 ? 'high' : score > 0.4 ? 'medium' : 'low';

        let dateStr = '';
        if (source.metadata && source.metadata.modified) {
            try {
                dateStr = new Date(source.metadata.modified).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            } catch (e) {
                // Ignore date parsing errors
            }
        }

        const name = (source.metadata && source.metadata.name) ? source.metadata.name : source.id;
        const type = getFileType(source);
        const summary = source.summary || '';

        card.innerHTML = `
            <div class="confidence-bar ${confidenceClass}"></div>
            <div class="source-header">
                <div class="file-type ${type}">${type}</div>
                <span class="source-title">${name}</span>
                ${dateStr ? `<span class="source-date">${dateStr}</span>` : ''}
            </div>
            <div class="source-snippet">${summary}</div>
        `;

        card.addEventListener('click', () => {
            if (currentCommandId) {
                ipcRenderer.send('ghost/overlay/open-dashboard', currentCommandId);
            } else if (source.metadata && source.metadata.path) {
                ipcRenderer.send('ghost/overlay/open-file', source.metadata.path);
            }
        });

        sourcesList.appendChild(card);
    });

    // Send resize event
    requestOverlayResize();
}

function setStateBadge(state) {
    if (!stateBadge) return;
    if (!state) {
        stateBadge.style.display = 'none';
        stateBadge.textContent = '';
        stateBadge.className = 'state-badge';
        return;
    }

    const normalized = String(state).toLowerCase();
    const label = normalized === 'failed'
        ? 'Failed'
        : normalized === 'pending'
            ? 'Pending'
            : 'Done';

    stateBadge.textContent = label;
    stateBadge.className = `state-badge ${normalized === 'failed' ? 'failed' : normalized === 'pending' ? 'pending' : 'done'}`;
    stateBadge.style.display = 'inline-flex';
}

function deriveState(actions) {
    if (!Array.isArray(actions) || actions.length === 0) return 'done';
    if (actions.some((a) => a.status === 'failed')) return 'failed';
    if (actions.some((a) => a.status === 'pending')) return 'pending';
    return 'done';
}

function formatActionDetail(action) {
    if (!action || !action.params) return '';
    const params = action.params || {};
    if (action.type === 'file.open') {
        const rawPath = params.path || '';
        return rawPath.split(/[\\/]/).pop() || 'file';
    }
    if (action.type === 'file.scroll') {
        return params.direction ? `scroll ${params.direction}` : 'scroll';
    }
    if (action.type === 'system.open') {
        return params.target || 'open';
    }
    if (action.type === 'system.type') {
        return 'type text';
    }
    if (action.type === 'reminder.create') {
        return params.title || 'reminder';
    }
    if (action.type === 'search.query') {
        return params.query || 'search';
    }
    if (action.type === 'info.summarize') {
        return params.topic || 'summary';
    }
    return '';
}

function renderActions(actions) {
    currentActions = Array.isArray(actions) ? actions : [];
    if (!actionsContainer || !actionsList) return;

    actionsList.innerHTML = '';

    if (currentActions.length === 0) {
        actionsContainer.style.display = 'none';
        return;
    }

    actionsContainer.style.display = 'flex';

    currentActions.forEach((entry, index) => {
        const action = entry?.action || {};
        const status = (entry?.status || 'pending').toLowerCase();
        const label = action.type || 'action';
        const detail = formatActionDetail(action);

        const item = document.createElement('div');
        item.className = 'action-item';

        const main = document.createElement('div');
        main.className = 'action-main';

        const labelEl = document.createElement('div');
        labelEl.className = 'action-label';
        labelEl.textContent = label;

        const detailEl = document.createElement('div');
        detailEl.className = 'action-detail';
        detailEl.textContent = detail;

        main.appendChild(labelEl);
        if (detail) main.appendChild(detailEl);

        const statusEl = document.createElement('div');
        statusEl.className = `action-status ${status}`;
        statusEl.textContent = status === 'failed' ? 'Failed' : status === 'success' ? 'Success' : 'Pending';

        item.appendChild(main);
        item.appendChild(statusEl);

        if (status === 'failed') {
            const retryBtn = document.createElement('button');
            retryBtn.className = 'action-retry';
            retryBtn.textContent = 'Retry';
            retryBtn.addEventListener('click', () => {
                retryBtn.disabled = true;
                ipcRenderer.send('ghost/overlay/retry-action', {
                    commandId: currentCommandId,
                    index,
                    action
                });
            });
            item.appendChild(retryBtn);
        }

        actionsList.appendChild(item);
    });

    requestOverlayResize();
}

function parseChoicesFromText(text) {
    if (!text) return [];
    const lines = text.split('\n');
    const choices = [];
    for (const line of lines) {
        const match = line.trim().match(/^(\d+)\)\s+(.+)/);
        if (match) {
            choices.push({ index: Number(match[1]), label: match[2].trim() });
        }
    }
    return choices;
}

function renderChoices(choices) {
    currentChoices = Array.isArray(choices) ? choices : [];
    if (!choicesContainer || !choicesList) return;

    choicesList.innerHTML = '';

    if (currentChoices.length === 0) {
        choicesContainer.style.display = 'none';
        return;
    }

    choicesContainer.style.display = 'flex';

    currentChoices.forEach((choice) => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        btn.textContent = `${choice.index}) ${choice.label}`;
        btn.addEventListener('click', () => {
            const buttons = choicesList.querySelectorAll('button');
            buttons.forEach((b) => {
                b.disabled = true;
            });
            ipcRenderer.send('ghost/overlay/choice', { text: String(choice.index) });
        });
        choicesList.appendChild(btn);
    });

    requestOverlayResize();
}

// Global API key storage
let currentApiKey = null;
let actionPayloadProvided = false;

ipcRenderer.on('update-sources', (event, payload) => {
    const { sources, commandId, apiKey, text, actions } = payload || {};
    currentCommandId = commandId;
    currentApiKey = apiKey;
    actionPayloadProvided = Array.isArray(actions);
    
    // Update response text if available
    if (text) {
        responseText.textContent = text;
        responseContainer.style.display = 'block';
        renderChoices(parseChoicesFromText(text));
    } else {
        responseContainer.style.display = 'none';
        responseText.textContent = '';
        renderChoices([]);
    }

    if (actionPayloadProvided) {
        renderActions(actions || []);
        setStateBadge(deriveState(actions || []));
    } else if (commandId) {
        setStateBadge('done');
    } else {
        setStateBadge(null);
        renderActions([]);
    }

    renderSources(sources);
    popup.style.display = 'flex';

    // Reset graph display
    const graphContainer = document.getElementById('graph-container');
    if (graphContainer) graphContainer.style.display = 'none';

    if (commandId) {
        renderGraph(commandId);
    }
});

// Simple D3 force graph renderer
function renderGraph(commandId) {
    if (!commandId) return;

    const graphContainer = document.getElementById('graph-container');
    const svg = document.getElementById('memory-graph');

    if (!svg) return;

    // Fetch command data with API key
    const headers = {};
    if (currentApiKey) {
        headers['Authorization'] = `Bearer ${currentApiKey}`;
    }

    fetch(`http://localhost:4000/api/commands/${commandId}`, { headers })
        .then(res => {
            if (!res.ok) throw new Error(`API Error: ${res.status}`);
            return res.json();
        })
        .then(command => {
            if (!command) {
                console.warn('No command found for:', commandId);
                graphContainer.style.display = 'none';
                requestOverlayResize();
                renderActions([]);
                return;
            }

            const actions = Array.isArray(command.actions) ? command.actions : [];
            if (!actionPayloadProvided) {
                renderActions(actions);
                setStateBadge(deriveState(actions));
            }

            if (!command.memories_used) {
                console.warn('No memories found for command:', commandId);
                graphContainer.style.display = 'none';
                requestOverlayResize();
                return;
            }

            // Build graph data
            const nodes = [{ id: 'root', type: 'query', label: 'Command', fx: 180, fy: 100 }];
            const links = [];

            command.memories_used.forEach(memory => {
                if (memory.metadata?.maker_verified) return;

                const isFile = !!memory.metadata?.path;
                const label = isFile
                    ? memory.metadata.path.split('/').pop()
                    : (memory.summary || memory.id).slice(0, 20);

                nodes.push({
                    id: memory.id,
                    type: isFile ? 'file' : (memory.type || 'memory'),
                    label: label,
                    path: memory.metadata?.path,
                    score: memory.score
                });

                links.push({
                    source: 'root',
                    target: memory.id,
                    value: memory.score
                });
            });

            // Clear previous graph
            svg.innerHTML = '';

            // Check for screenshot in the first memory (usually the most relevant one for recall)
            // or iterate to find one
            const screenshotMemory = command.memories_used.find(m => m.metadata && m.metadata.screenshot);

            if (screenshotMemory) {
                const screenshotPath = screenshotMemory.metadata.screenshot;
                console.log('Found screenshot:', screenshotPath);

                // Create an image element in the SVG or overlay
                // For better styling, let's append it to a dedicated container in the DOM, not the SVG
                let screenshotContainer = document.getElementById('screenshot-container');
                if (!screenshotContainer) {
                    screenshotContainer = document.createElement('div');
                    screenshotContainer.id = 'screenshot-container';
                    // Insert before graph container
                    graphContainer.parentNode.insertBefore(screenshotContainer, graphContainer);
                }

                screenshotContainer.innerHTML = `
                    <div class="screenshot-label">Context Snapshot</div>
                    <img src="file://${screenshotPath}" class="context-screenshot" data-path="${screenshotPath}" />
                `;
                screenshotContainer.style.display = 'block';

                const imgEl = screenshotContainer.querySelector('.context-screenshot');
                if (imgEl) {
                    imgEl.addEventListener('click', () => {
                        ipcRenderer.send('ghost/overlay/open-file', screenshotPath);
                    });
                    imgEl.style.cursor = 'pointer';
                    imgEl.title = 'Open screenshot';
                }
            } else {
                const sc = document.getElementById('screenshot-container');
                if (sc) sc.style.display = 'none';
            }

            // Show container
            graphContainer.style.display = 'flex';
            requestOverlayResize();

            // Create D3 force simulation
            const width = 320;
            const height = 160; // Match fixed graph container height

            const simulation = d3.forceSimulation(nodes)
                .force('link', d3.forceLink(links).id(d => d.id).distance(50))
                .force('charge', d3.forceManyBody().strength(-150))
                .force('center', d3.forceCenter(width / 2, height / 2))
                .force('collision', d3.forceCollide().radius(15));

            const svgElement = d3.select(svg);

            // Links
            const link = svgElement.append('g')
                .selectAll('line')
                .data(links)
                .enter().append('line')
                .attr('stroke', 'rgba(255,255,255,0.2)')
                .attr('stroke-width', d => Math.max(1, d.value * 2));

            // Nodes
            const node = svgElement.append('g')
                .selectAll('g')
                .data(nodes)
                .enter().append('g')
                .style('cursor', d => d.type === 'file' ? 'pointer' : 'default')
                .call(d3.drag()
                    .on('start', dragstarted)
                    .on('drag', dragged)
                    .on('end', dragended));

            node.append('circle')
                .attr('r', d => d.type === 'query' ? 8 : 6)
                .attr('fill', d => {
                    if (d.type === 'query') return '#0A84FF';
                    if (d.type === 'file') return '#30D158';
                    return '#FF9F0A';
                })
                .attr('stroke', '#FFF')
                .attr('stroke-width', 1.5)
                .on('click', function (event, d) {
                    if (d.type === 'file' && d.path) {
                        ipcRenderer.send('ghost/overlay/open-file', d.path);
                    }
                })
                .on('mouseover', function (event, d) {
                    if (d.type === 'file') {
                        d3.select(this).attr('r', 8).attr('stroke-width', 2);
                    }
                })
                .on('mouseout', function (event, d) {
                    if (d.type === 'file') {
                        d3.select(this).attr('r', 6).attr('stroke-width', 1.5);
                    }
                });

            node.append('text')
                .attr('dx', 10)
                .attr('dy', 3)
                .text(d => d.label)
                .style('font-size', '10px')
                .style('fill', '#FFF')
                .style('font-family', '-apple-system, BlinkMacSystemFont, sans-serif')
                .style('pointer-events', 'none');

            simulation.on('tick', () => {
                link
                    .attr('x1', d => d.source.x)
                    .attr('y1', d => d.source.y)
                    .attr('x2', d => d.target.x)
                    .attr('y2', d => d.target.y);

                node.attr('transform', d => `translate(${d.x},${d.y})`);
            });

            function dragstarted(event, d) {
                if (!event.active) simulation.alphaTarget(0.3).restart();
                d.fx = d.x;
                d.fy = d.y;
            }

            function dragged(event, d) {
                d.fx = event.x;
                d.fy = event.y;
            }

            function dragended(event, d) {
                if (!event.active) simulation.alphaTarget(0);
                if (d.type !== 'query') { // Keep root fixed
                    d.fx = null;
                    d.fy = null;
                }
            }
        })
        .catch(err => {
            console.error('Failed to load graph:', err);
            // Show error state instead of hiding completely
            graphContainer.style.display = 'flex';
            svg.innerHTML = '';
            const errorText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            errorText.setAttribute('x', '50%');
            errorText.setAttribute('y', '50%');
            errorText.setAttribute('text-anchor', 'middle');
            errorText.setAttribute('fill', 'rgba(255,255,255,0.5)');
            errorText.setAttribute('font-size', '12px');
            errorText.textContent = 'Graph unavailable';
            svg.appendChild(errorText);
            requestOverlayResize();
        });
}

// Note: update-sources listener is defined above - removed duplicate

ipcRenderer.on('ghost/overlay/toast', (_event, { title, body, duration }) => {
    toastTitle.textContent = title || 'Ghost';
    toastBody.textContent = body || '';

    toast.classList.add('visible');

    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.remove('visible');
    }, duration || 4000);
});

ipcRenderer.on('ghost/overlay/retry-result', (_event, payload) => {
    if (!payload || typeof payload.index !== 'number') return;
    if (!currentActions[payload.index]) return;

    currentActions[payload.index] = {
        ...currentActions[payload.index],
        status: payload.status || currentActions[payload.index].status,
        error: payload.error || currentActions[payload.index].error,
    };
    renderActions(currentActions);
    setStateBadge(deriveState(currentActions));
});

closeBtn.addEventListener('click', () => {
    ipcRenderer.send('ghost/overlay/close');
});

dismissBtn.addEventListener('click', () => {
    ipcRenderer.send('ghost/overlay/close');
});
