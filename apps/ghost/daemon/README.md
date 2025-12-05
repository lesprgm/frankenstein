# Ghost Daemon

Voice-activated AI assistant daemon that runs locally on your Mac with multi-modal capabilities.

## Features

### Voice & Audio
- **Hotkey Activation**: `Option+Space` (macOS) for instant voice commands
- **Wake Word Detection**: Say "Hey Ghost" (or "Hi Ghost", "Hello Ghost") for hands-free activation
- **Voice Recording**: With silence detection
- **Speech-to-Text**: Via Gemini API
- **Text-to-Speech**: ElevenLabs or system TTS with streaming support

### Multi-Modal Intelligence
- **Ghost Vision** (Screen Context): 
  - Captures screenshots using `screencapture`
  - Extracts text via macOS Vision framework (Swift)
  - Parallel processing with voice recording
  - Screenshots saved to `~/.ghost/screenshots/`
  
- **Contextual Reminders**:
  - Creates native Apple Reminders via EventKit (Swift)
  - Includes screen context in reminder notes
  - Natural language due date parsing

- **Semantic Search**:
  - Voice-activated search over Memory Layer
  - Results displayed via notifications

### Local Actions
- **File Operations**: Open files, scroll, navigate
- **Notifications**: Desktop notifications for results
- **File Indexing**: Scans configured directories for context

### AI Explainability
- **Memory Graph Notifications**: Shows reasoning path
- **Deep Links**: Opens dashboard to visualization

## Setup

1. Copy `config.example.json` to `config.json`
2. Configure your settings (API keys, directories, etc.)
3. Install dependencies: `npm install`
4. Run in development: `npm run dev`
5. Build for production: `npm run build`
6. Package distributables: `npm run package`

## Configuration

`config.json` example:
```json
{
  "user": {
    "id": "ghost"
  },
  "backend": {
    "url": "http://localhost:4000",
    "apiKey": "ghost-secret-key"
  },
  "stt": {
    "provider": "gemini",
    "apiKey": "YOUR_GEMINI_API_KEY"
  },
  "tts": {
    "provider": "elevenlabs",
    "apiKey": "YOUR_ELEVENLABS_API_KEY"
  },
  "files": {
    "scanDirectories": ["~/Documents/demofiles"]
  }
}
```

## New Services

### VisionService (`src/services/vision.ts`)
Captures screenshots and extracts text using macOS Vision framework.

```typescript
const vision = new VisionService();
const result = await vision.captureScreenContext();
// Returns { text: string, screenshotPath: string }
```

### RemindersService (`src/services/reminders.ts`)
Creates native Apple Reminders with EventKit.

```typescript
const reminders = new RemindersService();
await reminders.createReminder({
  title: 'Fix bug',
  notes: 'Code context here...',
  dueDate: '2025-11-27T09:00:00Z'
});
```

### ActivationServer (`src/services/activation-server.ts`)
HTTP server enabling external activation of the daemon (e.g. from the dashboard).

- **Port**: 3847 (fixed)
- **Endpoint**: `POST /activate`
- **Use Case**: Triggers the wake word / hotkey logic programmatically.

### IntentClassifier (`src/voice/intent-classifier.ts`)
Regex-based intent classification for core system commands and navigation.

- **Capabilities**: Detects system control (stop, pause), help requests, and navigation commands.
- **Performance**: Zero-latency local classification before hitting the LLM.


## Action Types

The daemon executes these actions returned by the backend:
- `file.open` - Opens files
- `file.scroll` - Scrolls active window
- `info.recall` - Shows memory notification
- `info.summarize` - Summarizes memories
- `reminder.create` - Creates Apple Reminder
- `search.query` - Searches Memory Layer

## macOS Permissions Required

Grant these permissions in System Settings → Privacy & Security:
- **Microphone** - For voice commands
- **Accessibility** - For scrolling and keyboard control
- **Screen Recording** - For screenshot capture
- **Calendars/Reminders** - For reminder creation

## Testing

Run tests:
```bash
npm test
```

Tests include:
- Vision service (OCR)
- Reminders service (EventKit)
- Action executor
- API client
- File scanner

## Error Handling

- Backend offline → Desktop notification with error
- STT failure → Notification prompting retry
- OCR failure → Falls back to non-visual mode
- Reminder creation failure → Error notification
- File not found → Action marked as failed

## Development

The daemon is built with:
- **Electron** - Cross-platform desktop app framework
- **TypeScript** - Type-safe development
- **Better-SQLite3** - Local caching (if needed)
- **Node.js Child Process** - For Swift script execution

---

## Development Approach

This daemon was developed using Kiro's spec-driven development methodology. The `.kiro/specs/ghost-daemon/` directory contains comprehensive specifications that guided the development of the multi-modal architecture, including:

- Voice interaction and hotkey handling
- Ghost Vision (macOS Vision framework integration)
- Contextual Reminders (Apple EventKit integration)  
- Local action execution and file operations

See the [main Ghost README](../README.md#development-approach) for complete details on the specification-driven development process and key architectural decisions.
