import { parentPort, workerData } from 'worker_threads';
import { pipeline, env } from '@xenova/transformers';

// Configure cache
if (workerData?.cacheDir) {
    env.cacheDir = workerData.cacheDir;
}
env.allowLocalModels = true;

let embedder: any = null;

async function initialize(modelName: string) {
    if (embedder) return;
    
    try {
        // Use feature-extraction pipeline
        embedder = await pipeline('feature-extraction', modelName, {
            quantized: true, // Use quantized model for speed
        });
        parentPort?.postMessage({ type: 'ready' });
    } catch (error) {
        parentPort?.postMessage({ type: 'error', error: String(error) });
    }
}

if (parentPort) {
    parentPort.on('message', async (message) => {
        const { id, type, text, texts, model } = message;

        try {
            if (type === 'init') {
                await initialize(model);
                return;
            }

            if (!embedder) {
                await initialize(model || 'Xenova/all-MiniLM-L6-v2');
            }

            if (type === 'embed') {
                const output = await embedder(text, { pooling: 'mean', normalize: true });
                const embedding = Array.from(output.data);
                parentPort?.postMessage({ id, result: embedding });
            } 
            else if (type === 'embedBatch') {
                // Process sequentially in worker to avoid memory spikes, but off main thread
                const results = [];
                for (const t of texts) {
                    const output = await embedder(t, { pooling: 'mean', normalize: true });
                    results.push(Array.from(output.data));
                }
                parentPort?.postMessage({ id, result: results });
            }
        } catch (error) {
            parentPort?.postMessage({ id, error: String(error) });
        }
    });
}
