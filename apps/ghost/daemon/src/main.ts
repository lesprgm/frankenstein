import path from 'node:path';
import crypto from 'node:crypto';
import type { Tray as TrayType, IpcMainEvent } from 'electron';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const electron = require('electron');
const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, shell } = electron;
import { loadConfig } from './config';
import { WindowManager } from './windows/window-manager';
import { GhostAPIClient } from './services/api-client';
import { HotkeyHandler } from './voice/hotkey-handler';
import { VoicePipeline } from './voice/voice-pipeline';
import { WhisperSTT } from './voice/whisper';
import { createTextToSpeech } from './tts';
import { ActionExecutor } from './actions/action-executor';
import { VoiceFeedbackService } from './services/voice-feedback';
import { WakeWordService } from './services/wake-word';
import { ActivationServer } from './services/activation-server';
import { IntentClassifier, UserIntent } from './voice/intent-classifier';
import { fileScanner } from './files/file-scanner';
import { streamChunksIfReady, flushChunks } from './utils/text-processing';

// eslint-disable-next-line @typescript-eslint/no-var-requires
if (require('electron-squirrel-startup')) {
  app.quit();
}

const config = loadConfig();
const visionConfig = config.vision ?? { enabled: true, captureMode: 'on-demand' as const };
const api = new GhostAPIClient(config);
const hotkey = new HotkeyHandler(config.voice.hotkey);
let tray: TrayType | null = null;
const windowManager = new WindowManager();
let voicePipeline: VoicePipeline;
const stt = new WhisperSTT(config.voice.sttApiKey, {
  endpoint: config.voice.sttEndpoint,
  model: config.voice.sttModel,
  provider: config.voice.sttProvider,
});
const textToSpeech = createTextToSpeech(config.voice);

import { ExplainabilityNotifier } from './services/explainability-notifier';

import { VisionService } from './services/vision';
import { RemindersService } from './services/reminders';
import { attachOverlayWindowManager, showOverlayToast } from './services/overlay-notifier';

// Create voice feedback service and action executor with TTS support
const voiceFeedback = new VoiceFeedbackService(textToSpeech);
const explainabilityNotifier = new ExplainabilityNotifier('http://localhost:5174', windowManager, config.backend.apiKey);
const remindersService = new RemindersService();
const actionExecutor = new ActionExecutor(voiceFeedback, explainabilityNotifier, remindersService, api);
const visionService = new VisionService();

// Conversational mode state (in-session only)
let conversationalMode = config.conversationalMode ?? false;

function createTray(): void {
  const base64Icon = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAt8B9JpN5VQAAAAASUVORK5CYII=';
  const icon = nativeImage.createFromBuffer(Buffer.from(base64Icon, 'base64'));
  tray = new Tray(icon);
  if (tray) tray.setToolTip('Ghost is running');
  updateTrayMenu();
}

function updateTrayMenu(): void {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    {
      label: `Chat Mode: ${conversationalMode ? 'ON' : 'OFF'}`,
      click: () => {
        conversationalMode = !conversationalMode;
        const status = conversationalMode ? 'Chat mode enabled' : 'Action mode enabled';
        showOverlayToast('Ghost', status);
        textToSpeech.speak(conversationalMode ? 'Chat mode!' : 'Action mode.');
        updateTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: 'Show overlay toast (test)',
      click: () => showOverlayToast('Ghost', 'This is the custom overlay'),
    },
    {
      label: 'Scan files',
      click: () => triggerFileScan(),
    },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(menu);
}

async function triggerFileScan(): Promise<void> {
  try {
    const files = await fileScanner.scan(config.files.scanDirectories, {
      includeExtensions: config.files.includeExtensions,
      maxDepth: config.files.maxDepth,
      excludePatterns: config.files.excludePatterns,
      limit: 1000,
      // Explicit rescan to refresh cache + backend index
      forceRescan: true,
    });
    if (files.length === 0) {
      notifyError('File scan skipped', 'No files found to index. Check scanDirectories in config.json.');
      return;
    }
    const result = await api.indexFiles(files);
    if (!result.ok) {
      const message =
        // Axios-style error shape
        (result as any).error?.response?.data?.error ||
        (result as any).error?.message ||
        'Failed to index files';
      throw new Error(message);
    }
    showOverlayToast('Ghost', `Indexed ${files.length} files`);
  } catch (error) {
    notifyError('File scan failed', error instanceof Error ? error.message : 'Unknown error');
  }
}

let isCommandActive = false;

async function handleHotkey(): Promise<void> {
  if (isCommandActive) {
    console.log('[Ghost] Command already active, ignoring hotkey');
    return;
  }
  isCommandActive = true;
  const overallStart = Date.now();
  console.info('[Ghost][PERF] ⏱️  Pipeline started at', new Date().toISOString());

  try {
    if (!voicePipeline) {
      notifyError('Voice pipeline unavailable', 'Please restart Ghost');
      return;
    }
    console.info('[Ghost] Hotkey activated — starting recording');

    // Stage 1: Screen Capture (parallel with recording)
    // Only capture if mode is explicitly 'always' (default should be 'on-demand')
    let screenCapturePromise: Promise<{ text: string; screenshotPath: string } | null> | null = null;
    const shouldCapturePreStt =
      visionConfig.enabled && visionConfig.captureMode === 'always';

    const visionStart = Date.now();
    if (shouldCapturePreStt) {
      console.log('[Ghost][PERF] 📸 Vision capture started (Pre-emptive)');
      screenCapturePromise = visionService.captureScreenContext();
    }

    // Stage 2: Voice Recording
    const recordStart = Date.now();
    console.log('[Ghost][PERF] 🎤 Recording started');

    // Show listening indicator with waveform
    showOverlayToast('Ghost', 'Listening...', 10000, 'listening', true);

    const audio = await voicePipeline.recordOnce();
    const recordDuration = Date.now() - recordStart;
    console.log(`[Ghost][PERF] ✅ Recording completed in ${recordDuration}ms`);

    // Update toast to processing state (stops waveform)
    showOverlayToast('Ghost', 'Processing...', 10000, 'listening', false);

    // Stage 3: Speech-to-Text
    const sttStart = Date.now();
    console.log('[Ghost][PERF] 🗣️  STT processing started');
    const transcript = await stt.transcribe(audio);
    const sttDuration = Date.now() - sttStart;
    console.log(`[Ghost][PERF] ✅ STT completed in ${sttDuration}ms`);

    if (!transcript.ok) {
      const message = 'message' in transcript.error ? transcript.error.message : transcript.error.type;
      notifyError('Speech-to-text failed', message);
      return;
    }
    console.info('[Ghost] Transcript captured:', transcript.value);

    // Classify user intent
    const intent = IntentClassifier.classify(transcript.value);

    // Handle Introduction
    if (intent === UserIntent.INTRODUCTION) {
      const introduction = IntentClassifier.getIntroduction();
      await textToSpeech.speak(introduction);
      showOverlayToast('Ghost', introduction);
      return;
    }

    // Handle Mode Toggles
    if (intent === UserIntent.CHAT_MODE) {
      conversationalMode = true;
      await textToSpeech.speak('Chat mode enabled!');
      updateTrayMenu();
      return;
    }

    if (intent === UserIntent.ACTION_MODE) {
      conversationalMode = false;
      await textToSpeech.speak('Action mode.');
      updateTrayMenu();
      return;
    }

    if (intent === UserIntent.SYSTEM_CONTROL) {
      const lower = transcript.value.toLowerCase();
      if (lower.includes('help') || lower.includes('commands') || lower.includes('what can you do')) {
        await textToSpeech.speak('I can search your memories, open files, create reminders, and see your screen.');
        return;
      }

      // Stop/Cancel/Silence
      textToSpeech.stop();
      showOverlayToast('Ghost', 'Stopped.');
      return;
    }

    // Stage 4: Complete Vision Capture (if needed)
    const shouldCapturePostStt =
      visionConfig.enabled &&
      visionConfig.captureMode === 'on-demand' &&
      (IntentClassifier.classify(transcript.value) === UserIntent.SCREEN_CONTEXT);
    if (!screenCapturePromise && shouldCapturePostStt) {
      const visionPostStart = Date.now();
      console.log('[Ghost][PERF] 📸 Vision capture started (on-demand)');
      screenCapturePromise = visionService.captureScreenContext();
    }

    const screenResult = screenCapturePromise ? await screenCapturePromise : null;
    if (screenCapturePromise) {
      const visionDuration = Date.now() - visionStart;
      console.log(`[Ghost][PERF] ✅ Vision capture completed in ${visionDuration}ms`);
    }

    let screenContext: string | undefined;
    let screenshotPath: string | undefined;

    if (screenResult) {
      screenContext = screenResult.text;
      screenshotPath = screenResult.screenshotPath;
      console.info('[Ghost] Screen context captured:', screenContext.length, 'chars');
      console.info('[Ghost] Screenshot saved to:', screenshotPath);
    }

    // Stage 5: LLM API Call (streaming)
    const apiStart = Date.now();
    console.log('[Ghost][PERF] 🤖 LLM API call started (streaming)');

    const tokenBuffer: string[] = [];
    let hasStreamed = false;
    let firstTokenTime: number | null = null;

    let commandResult = await api.sendCommandStream(
      transcript.value,
      (token) => {
        if (firstTokenTime === null) {
          firstTokenTime = Date.now();
          const ttft = firstTokenTime - apiStart;
          console.log(`[Ghost][PERF] ⚡ Time to first token: ${ttft}ms`);
        }
        tokenBuffer.push(token);
        if (streamChunksIfReady(tokenBuffer, textToSpeech)) {
          hasStreamed = true;
        }
        console.info('[Ghost][LLM][token]', token);
      },
      screenContext,
      screenshotPath,
      conversationalMode
    );

    const apiDuration = Date.now() - apiStart;
    console.log(`[Ghost][PERF] ✅ LLM API completed in ${apiDuration}ms`);

    if (!commandResult.ok) {
      console.warn('[Ghost] Streaming failed, falling back to non-streaming', commandResult.error);
      const fallbackStart = Date.now();
      console.log('[Ghost][PERF] 🔄 Fallback API call started');
      commandResult = await api.sendCommand(transcript.value, screenContext, screenshotPath, conversationalMode);
      const fallbackDuration = Date.now() - fallbackStart;
      console.log(`[Ghost][PERF] ✅ Fallback API completed in ${fallbackDuration}ms`);
    }

    if (!commandResult.ok) {
      notifyError('Backend offline', 'Could not reach Ghost backend');
      return;
    }

    const response = commandResult.value;

    // Stage 6: TTS Completion
    const ttsStart = Date.now();
    await flushChunks(tokenBuffer, textToSpeech, response.assistant_text, hasStreamed);
    const ttsDuration = Date.now() - ttsStart;
    console.log(`[Ghost][PERF] ✅ TTS flush completed in ${ttsDuration}ms`);

    // Stage 7: Action Execution
    const actionStart = Date.now();
    console.log('[Ghost][PERF] ⚙️  Action execution started');
    const actionResults = await actionExecutor.executeBatch(response.actions, {
      commandId: response.command_id,
      memories: response.memories_used,
      screenContext: screenContext && screenshotPath ? { text: screenContext, screenshotPath } : undefined
    });
    const actionDuration = Date.now() - actionStart;
    console.log(`[Ghost][PERF] ✅ Actions completed in ${actionDuration}ms`);

    await api.sendActionResults(response.command_id, actionResults);

    // Show overlay with sources instead of native notification
    if (response.memories_used && response.memories_used.length > 0) {
      const deduped = dedupeSources(
        response.memories_used.map((m: any) => ({
          id: m.id,
          type: m.type,
          score: m.score,
          summary: m.summary,
          metadata: m.metadata
        }))
      );

      windowManager.showOverlay(deduped, response.command_id, config.backend.apiKey);
      console.info('[Ghost] Showed overlay with', deduped.length, 'sources');
    } else {
      // If no sources, just show a simple notification if needed, or nothing.
      // For now, let's show the overlay anyway if there's a command ID, so the graph can show "Command" node.
      if (response.command_id) {
        windowManager.showOverlay([], response.command_id, config.backend.apiKey);
      }
      console.info('[Ghost] No memories to show');
    }

    // Overall Pipeline Summary
    const totalDuration = Date.now() - overallStart;
    console.log('');
    console.log('[Ghost][PERF] ═══════════════════════════════════════════');
    console.log(`[Ghost][PERF] 📊 TOTAL PIPELINE: ${totalDuration}ms (${(totalDuration / 1000).toFixed(2)}s)`);
    console.log('[Ghost][PERF] ═══════════════════════════════════════════');
    console.log('');

    // No need to await TTS; queued chunks run in the background.
  } catch (error) {
    notifyError('Command processing failed', error instanceof Error ? error.message : 'Unknown error');
  } finally {
    isCommandActive = false;
  }
}



function notifyError(title: string, message: string): void {
  console.error(title, message);
  showOverlayToast(title, message);
}

app.whenReady().then(() => {
  if (config.autoLaunch) {
    app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
  }

  windowManager.createMainWindow();
  windowManager.createOverlayWindow();
  attachOverlayWindowManager(windowManager);

  // Initialize Voice Pipeline
  voicePipeline = new VoicePipeline(
    config.voice.silenceThreshold,
    config.voice.maxRecordingDuration,
    windowManager.getMainWindow() || undefined
  );

  createTray();
  hotkey.register();
  triggerFileScan();

  // IPC Handlers
  ipcMain.handle('ghost/scan-files', async () => {
    await triggerFileScan();
    return { ok: true };
  });

  ipcMain.on('ghost/overlay/close', () => {
    windowManager.hideOverlay();
  });

  ipcMain.on('ghost/overlay/resize', (event: IpcMainEvent, height: number) => {
    windowManager.resizeOverlay(height);
  });

  ipcMain.on('ghost/overlay/open-file', async (_event: IpcMainEvent, filePath: string) => {
    try {
      await shell.openPath(filePath);
    } finally {
      // Drop the overlay so the opened app/file can receive scroll and input
      windowManager.hideOverlay();
    }
  });

  ipcMain.on('ghost/overlay/open-dashboard', (event: IpcMainEvent, commandId: string) => {
    const dashboardUrl = `http://localhost:5174/command/${commandId}`;
    console.log('[Ghost] Opening dashboard:', dashboardUrl);
    shell.openExternal(dashboardUrl);
  });

  // External activation handler (for dashboard button)
  ipcMain.handle('ghost/activate', async () => {
    console.log('[Ghost] External activation triggered');
    await handleHotkey();
    return { success: true };
  });

  app.on('activate', () => {
    windowManager.ensureMainWindow();
  });

  // Start wake word service
  const wakeWordService = new WakeWordService(
    voicePipeline,
    stt,
    textToSpeech,
    async () => {
      // The service pauses itself before calling this
      await handleHotkey();
    }
  );

  // Hook into hotkey handler to pause/resume wake word
  hotkey.on('activate', async () => {
    console.log('[Ghost] Hotkey triggered');
    wakeWordService.pause();

    // Give a small buffer for the loop to actually stop recording if it was in the middle of it
    // This is a hack, but effective for the demo to prevent "Recording already in progress"
    await new Promise(resolve => setTimeout(resolve, 100));

    // Force stop any active recording in the pipeline if possible, or just wait
    // Ideally voicePipeline should have a 'stopRecording' method, but for now we rely on the pause

    // Feedback to simulate wake word
    await textToSpeech.speak('Mhmm?');

    handleHotkey().finally(() => {
      console.log('[Ghost] Hotkey finished, resuming wake word');
      wakeWordService.resume();
    });
  });

  // wakeWordService.start();
  console.log('[Ghost] Wake word service disabled for stability. Use hotkey to activate.');

  // Start HTTP server for external activation (dashboard button)
  const activationServer = new ActivationServer(3847, handleHotkey);
  activationServer.start();
});

app.on('will-quit', () => {
  hotkey.unregister();
});

const MIN_OVERLAY_SCORE = 0.35;
const MAX_NODES_PER_SOURCE = 3;

function dedupeSources(sources: Array<{ id: string; type: string; summary: string; score?: number; metadata?: any }>) {
  const seen = new Map<string, { id: string; type: string; summary: string; score?: number; metadata?: any }>();

  for (const s of sources) {
    const key = crypto.createHash('md5').update(`${s.type}|${s.summary}`).digest('hex');
    if (!seen.has(key)) {
      seen.set(key, s);
    } else {
      const existing = seen.get(key)!;
      if ((s.score ?? 0) > (existing.score ?? 0)) {
        seen.set(key, s);
      }
    }
  }

  const deduped = Array.from(seen.values());

  // Filter out low-signal nodes unless they are explicit file/entity references
  const filtered = deduped.filter(
    (s) => (s.score ?? 0) >= MIN_OVERLAY_SCORE || s.type?.startsWith('entity.file')
  );

  // Limit how many nodes we show per source (path/name/summary bucket) to keep the graph concise
  const grouped = new Map<string, Array<{ id: string; type: string; summary: string; score?: number; metadata?: any }>>();
  for (const s of filtered) {
    const sourceKey =
      (s.metadata?.path?.toLowerCase?.() as string) ||
      (s.metadata?.name?.toLowerCase?.() as string) ||
      s.summary?.toLowerCase() ||
      'unknown';
    const list = grouped.get(sourceKey) ?? [];
    if (list.length < MAX_NODES_PER_SOURCE) {
      list.push(s);
      grouped.set(sourceKey, list);
    }
  }

  return Array.from(grouped.values())
    .flat()
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}


