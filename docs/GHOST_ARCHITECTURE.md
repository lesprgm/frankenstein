# Ghost Architecture

This document provides a comprehensive technical overview of the Ghost application architecture, covering all major components, their interactions, data flows, and design decisions.

## Table of Contents

1. [System Overview](#system-overview)
2. [Component Architecture](#component-architecture)
   - [Daemon](#daemon)
   - [Backend](#backend)
   - [Dashboard](#dashboard)
3. [Core Subsystems](#core-subsystems)
   - [Voice Pipeline](#voice-pipeline)
   - [Vision Service](#vision-service)
   - [Memory Layer Integration](#memory-layer-integration)
   - [LLM Coordination](#llm-coordination)
   - [Explainability Service](#explainability-service)
4. [Data Flow](#data-flow)
5. [Storage Architecture](#storage-architecture)
6. [Security and Privacy](#security-and-privacy)
7. [External Integrations](#external-integrations)
8. [Configuration Management](#configuration-management)

---

## System Overview

Ghost is a multi-modal, voice-first AI assistant designed for macOS. The system follows a three-tier architecture with clear separation of concerns:

```
+-------------------+     +-------------------+     +-------------------+
|                   |     |                   |     |                   |
|      Daemon       |<--->|      Backend      |<--->|     Dashboard     |
|   (Electron/Node) |     |   (Hono/Node.js)  |     |   (React/Vite)    |
|                   |     |                   |     |                   |
+-------------------+     +-------------------+     +-------------------+
        |                         |
        v                         v
+-------------------+     +-------------------+
|  Native Services  |     |   External APIs   |
|  (Swift Binaries) |     | (Gemini, ElevenLabs)|
+-------------------+     +-------------------+
```

### Design Philosophy

1. **Privacy-First**: All screen capture and OCR processing occurs locally using macOS native frameworks. Only extracted text is transmitted to cloud LLMs.

2. **Modularity**: Each component (Daemon, Backend, Dashboard) operates independently and communicates via HTTP APIs and Server-Sent Events (SSE).

3. **Voice-First Interaction**: The primary interaction mode is voice, with visual feedback provided through overlays and the dashboard.

4. **Local-First Storage**: All persistent data is stored in a local SQLite database with vector embeddings for semantic search.

---

## Component Architecture

### Daemon

**Location**: `apps/ghost/daemon/`

**Runtime**: Electron with Node.js main process

**Purpose**: The Daemon is the "body" of Ghost. It handles all local system interactions, audio processing, and native macOS integrations.

#### Directory Structure

```
daemon/src/
  main.ts              # Application entry point, hotkey registration
  config.ts            # Configuration loader
  tts.ts               # Text-to-speech service
  types.ts             # TypeScript type definitions
  
  voice/
    voice-pipeline.ts  # Audio recording and voice activity detection
    transcription.ts   # Speech-to-text via Groq Whisper
    intent-classifier.ts # Command pattern matching
    
  services/
    ghost-api-client.ts  # HTTP client for backend communication
    activation-server.ts # HTTP server for dashboard activation
    vision.ts            # Screen capture and OCR coordination
    action-executor.ts   # Local action execution (files, scroll, etc.)
    reminder-bridge.ts   # Apple Reminders integration
    
  overlay/
    overlay-window.ts    # Floating overlay UI management
    overlay-manager.ts   # State management for overlays
    
  ocr/
    native-ocr.ts        # macOS Vision framework wrapper
    
  windows/
    window-manager.ts    # Electron window management
```

#### Key Responsibilities

1. **Global Hotkey Management**: Registers and handles `Option+Space` system-wide hotkey for activation.

2. **Voice Activity Detection (VAD)**: Uses Neural VAD (`@ricky0123/vad-node`) for real-time speech detection with ONNX runtime, replacing the previous `sox`-based silence detection.

3. **Audio Recording**: Captures microphone input in WAV format, buffered for streaming to transcription services.

4. **Screen Capture**: Takes screenshots using macOS native APIs and processes them through the Vision framework for OCR.

5. **Text-to-Speech**: Synthesizes speech responses using ElevenLabs API or system TTS fallback.

6. **Local Actions**: Executes file operations, scrolling, and application control via AppleScript and native APIs.

7. **Reminders Integration**: Creates Apple Reminders via EventKit bridge (Swift binary).

#### Process Model

The Daemon runs as a single Electron main process with no renderer windows (headless mode). Overlay windows are created on-demand as transparent, always-on-top BrowserWindows.

```
Main Process
    |
    +-- Voice Pipeline (async loop)
    |       |-- Neural VAD
    |       |-- Groq Whisper Transcription
    |       |-- Intent Classification
    |
    +-- Vision Service (on-demand)
    |       |-- Native OCR Bridge
    |       |-- Screenshot Management
    |
    +-- Action Executor (event-driven)
    |       |-- File Operations
    |       |-- Scroll Commands
    |       |-- Reminder Bridge
    |
    +-- Activation Server (HTTP)
            |-- Port 3847
            |-- /activate endpoint
```

---

### Backend

**Location**: `apps/ghost/backend/`

**Runtime**: Node.js with Hono framework

**Purpose**: The Backend is the "brain" of Ghost. It manages memory storage, coordinates LLM interactions, and provides APIs for the Daemon and Dashboard.

#### Directory Structure

```
backend/src/
  index.ts              # Hono app setup, route registration
  types.ts              # Shared type definitions
  
  routes/
    commands.ts         # Command processing endpoint
    search.ts           # Semantic search endpoint
    memories.ts         # Memory CRUD operations
    files.ts            # File indexing and search
    sse.ts              # Server-Sent Events for streaming
    explain.ts          # Explainability endpoint
    summarize-context.ts # Screen context summarization
    
  services/
    llm-coordinator.ts       # LLM orchestration and response generation
    memory-layer-integration.ts # MemoryLayer package integration
    memory-consolidation.ts  # Memory deduplication and merging
    explainability-service.ts # Memory graph and reasoning paths
    file-watcher.ts          # File system monitoring
    
  adapters/
    local-storage-client.ts    # SQLite adapter for MemoryLayer
    local-embedding-provider.ts # Local embedding generation
    single-user-manager.ts     # Single-user workspace management
    
  db/
    migrations.ts        # Database schema management
    
  middleware/
    cors.ts              # CORS configuration
```

#### Key Services

**LLM Coordinator**

The `LLMCoordinator` class orchestrates all LLM interactions:

- Manages conversation context building
- Coordinates with MemoryLayer for context retrieval
- Routes requests to appropriate LLM providers (Gemini, OpenRouter)
- Handles response streaming via SSE
- Supports specialized modes: conversational, search, screen summary

**Memory Layer Integration**

Integrates the MemoryLayer packages for structured memory management:

- `ContextEngine`: Builds context from stored memories
- `MemoryExtractor`: Extracts structured memories from text
- `ChatCapture`: Normalizes conversation data
- Supports MAKER reliability layer for high-confidence extraction

**Explainability Service**

Provides transparency into Ghost's reasoning:

- Generates memory graphs showing relationships
- Calculates confidence scores with explanations
- Tracks source attribution for all retrieved context

#### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/commands` | POST | Process voice command |
| `/api/commands` | GET | List command history |
| `/api/commands/:id` | GET | Get command details with memory graph |
| `/api/memories` | GET | List/search memories |
| `/api/memories/:id` | GET | Get memory details |
| `/api/search` | POST | Semantic search |
| `/api/files/index` | POST | Index file content |
| `/api/explain/:commandId` | GET | Get explainability data |
| `/api/summarize-context` | POST | Summarize screen context |
| `/api/sse/:commandId` | GET | SSE stream for command |

---

### Dashboard

**Location**: `apps/ghost/dashboard/`

**Runtime**: React 18 with Vite

**Purpose**: The Dashboard is the "face" of Ghost. It provides visual interaction, command history, and explainability features.

#### Directory Structure

```
dashboard/src/
  App.tsx               # Main application component
  main.tsx              # Application entry point
  
  components/
    CommandList.tsx     # Command history list
    CommandDetail.tsx   # Single command view with graph
    MemoryGraph.tsx     # D3.js force-directed graph
    SearchBar.tsx       # Semantic search input
    SourceOverlay.tsx   # Context source viewer
    
  hooks/
    useCommands.ts      # Command data fetching
    useSSE.ts           # SSE connection management
    useMemories.ts      # Memory data fetching
    
  lib/
    api.ts              # Backend API client
    types.ts            # TypeScript definitions
```

#### Key Features

1. **Real-time Updates**: Uses SSE to stream command responses in real-time.

2. **Memory Visualization**: D3.js force-directed graphs show memory relationships.

3. **Source Attribution**: Clickable sources with confidence scores and scroll-to-context.

4. **Command History**: Paginated list of all processed commands with search.

---

## Core Subsystems

### Voice Pipeline

The voice pipeline handles end-to-end voice interaction:

```
Microphone Input
       |
       v
+-----------------+
|   Neural VAD    |  (Real-time speech detection)
|   (ONNX/Silero) |
+-----------------+
       |
       v (speech segments)
+-----------------+
|  Audio Buffer   |  (WAV accumulation)
+-----------------+
       |
       v (complete utterance)
+-----------------+
| Groq Whisper    |  (Speech-to-text)
| Transcription   |
+-----------------+
       |
       v (text)
+-----------------+
|    Intent       |  (Pattern matching)
|   Classifier    |
+-----------------+
       |
       v (classified intent)
+-----------------+
|    Action       |  (Route to handler)
|   Dispatcher    |
+-----------------+
```

#### Voice Activity Detection

The system uses Silero VAD via `@ricky0123/vad-node` with ONNX runtime:

- **Sample Rate**: 16kHz mono
- **Frame Duration**: Configurable (default 96ms)
- **Threshold**: Configurable (default 0.5)
- **Pre-speech Padding**: 250ms
- **Post-speech Padding**: 500ms

This approach provides lower latency and higher accuracy compared to the previous `sox`-based silence detection.

#### Intent Classification

Intent classification uses regex-based pattern matching for deterministic routing:

| Intent | Example Patterns |
|--------|-----------------|
| Introduction | "who are you", "what can you do" |
| Reminder | "remind me", "set a reminder" |
| Search | "search for", "find files about" |
| Scroll | "scroll down", "scroll up" |
| Screen Context | "what's on my screen", "what am I looking at" |
| Summary | "summarize this", "give me a summary" |
| Help | "help", "what can I do" |

---

### Vision Service

The Vision Service handles screen capture and OCR:

```
Screen Capture Request
         |
         v
+-------------------+
|   Screenshot      |  (macOS screencapture)
|   Capture         |
+-------------------+
         |
         v (PNG file)
+-------------------+
|   Swift OCR       |  (Vision framework)
|   Bridge          |
+-------------------+
         |
         v (extracted text)
+-------------------+
|   Text            |  (Cleanup, dedup)
|   Processing      |
+-------------------+
         |
         v
+-------------------+
|   Memory          |  (Store as visual context)
|   Storage         |
+-------------------+
```

#### Native OCR Bridge

The OCR bridge is a compiled Swift binary that:

1. Loads the screenshot image
2. Creates a VNRecognizeTextRequest
3. Processes with VNImageRequestHandler
4. Returns JSON with text and bounding boxes

Configuration:

- **Recognition Level**: Accurate (not fast)
- **Language Correction**: Enabled
- **Languages**: English primary

#### Screenshot Management

Screenshots are stored in `~/.ghost/screenshots/` with metadata:

- Timestamp
- Associated command ID
- OCR text content
- Window/application context

---

### Memory Layer Integration

Ghost integrates the MemoryLayer packages for structured memory:

```
                    +-------------------+
                    |   MemoryExtractor |
                    |   (extraction)    |
                    +-------------------+
                            |
                            v
+-------------------+       |       +-------------------+
|   ChatCapture     |------>+<------|   ContextEngine   |
|   (normalization) |       |       |   (retrieval)     |
+-------------------+       |       +-------------------+
                            |
                            v
                    +-------------------+
                    |   StorageClient   |
                    |   (SQLite)        |
                    +-------------------+
```

#### Memory Types

| Type | Description | Example |
|------|-------------|---------|
| `entity` | Named entities (people, projects, files) | "Project Alpha", "Sarah" |
| `fact` | Factual statements | "Postgres is the main database" |
| `decision` | Decisions made | "We chose React for the frontend" |
| `doc.chunk` | Document content chunks | Indexed file content |

#### Extraction Strategies

Two extraction strategies are available:

1. **StructuredOutputStrategy**: Single LLM call with JSON schema output. Fast but single point of failure.

2. **MakerStrategy**: Multi-agent consensus with parallel microagents and voting. Higher reliability but increased latency and token usage.

Strategy selection is controlled by `MAKER_ENABLED` environment variable.

---

### LLM Coordination

The LLM Coordinator manages all LLM interactions:

```
Command Input
      |
      v
+-------------------+
|  Context Builder  |  (Query MemoryLayer)
+-------------------+
      |
      v
+-------------------+
|  Prompt Assembly  |  (System + Context + Query)
+-------------------+
      |
      v
+-------------------+
|  LLM Provider     |  (Gemini/OpenRouter)
+-------------------+
      |
      v (streaming)
+-------------------+
|  Response Parser  |  (Extract actions, text)
+-------------------+
      |
      v
+-------------------+
|  SSE Broadcaster  |  (Stream to clients)
+-------------------+
```

#### Provider Configuration

| Provider | Use Case | Configuration |
|----------|----------|---------------|
| Gemini Pro | Primary reasoning | `GEMINI_API_KEY` |
| Gemini Flash | Fast responses, MAKER | `GEMINI_API_KEY` |
| OpenRouter | Fallback, alternative models | `OPENROUTER_API_KEY` |

#### Context Building

Context is built in priority order:

1. System prompt with capabilities
2. Recent conversation history
3. Retrieved memories (semantic search)
4. Current screen context (if applicable)
5. Active file context

Token budget is enforced to stay within model limits.

---

### Explainability Service

The Explainability Service provides transparency:

```
Command ID
     |
     v
+-------------------+
|  Memory Graph     |  (Build relationship graph)
|  Builder          |
+-------------------+
     |
     v
+-------------------+
|  Confidence       |  (Calculate scores)
|  Calculator       |
+-------------------+
     |
     v
+-------------------+
|  Source           |  (Track attribution)
|  Aggregator       |
+-------------------+
     |
     v
{
  "memories": [...],
  "graph": { nodes: [...], edges: [...] },
  "confidenceBreakdown": {...},
  "sources": [...]
}
```

#### Memory Graph Structure

Nodes represent memories with properties:

- ID, type, content
- Confidence score
- Timestamp, source

Edges represent relationships:

- Type (related_to, derived_from, etc.)
- Strength (0.0-1.0)
- Direction

---

## Data Flow

### Command Processing Flow

```
1. User speaks "What was the decision about the database?"
                |
2. Daemon captures audio via Voice Pipeline
                |
3. Neural VAD detects speech end
                |
4. Audio sent to Groq Whisper for transcription
                |
5. Intent classified as "conversational"
                |
6. Daemon sends POST /api/commands to Backend
                |
7. Backend queries MemoryLayer for relevant context
                |
8. LLM Coordinator builds prompt with context
                |
9. Gemini generates response (streaming)
                |
10. SSE broadcasts tokens to Dashboard and Daemon
                |
11. Daemon synthesizes speech via ElevenLabs
                |
12. Memory extracted and stored for future recall
```

### Screen Context Flow

```
1. User speaks "Remind me to fix this tomorrow"
                |
2. Daemon captures screenshot in parallel with audio
                |
3. Swift OCR extracts text from screenshot
                |
4. Backend receives command + screen context
                |
5. LLM summarizes screen context for reminder notes
                |
6. Reminder Bridge creates Apple Reminder
                |
7. Screenshot saved to ~/.ghost/screenshots/
                |
8. Visual memory stored in MemoryLayer
```

---

## Storage Architecture

### SQLite Database Schema

**Location**: `./ghost.db` (configurable via `DATABASE_PATH`)

```sql
-- Core tables
memories (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  type TEXT,
  content TEXT,
  summary TEXT,
  confidence REAL,
  created_at TEXT,
  updated_at TEXT,
  metadata TEXT
)

relationships (
  id TEXT PRIMARY KEY,
  source_id TEXT,
  target_id TEXT,
  type TEXT,
  strength REAL,
  workspace_id TEXT
)

commands (
  id TEXT PRIMARY KEY,
  transcript TEXT,
  intent TEXT,
  response TEXT,
  created_at TEXT,
  memory_ids TEXT,
  screen_context TEXT
)

files (
  id TEXT PRIMARY KEY,
  path TEXT,
  content_hash TEXT,
  indexed_at TEXT,
  workspace_id TEXT
)
```

### Vector Embeddings

Embeddings are generated locally using the `LocalEmbeddingProvider`:

- Model: All-MiniLM-L6-v2 (via Transformers.js)
- Dimension: 384
- Storage: Separate vector table with memory_id foreign key

### File Storage

| Location | Content |
|----------|---------|
| `~/.ghost/screenshots/` | All captured screenshots |
| `./ghost.db` | SQLite database |
| `./ghost.db-wal` | Write-ahead log |
| `./ghost.db-shm` | Shared memory file |

---

## Security and Privacy

### Data Privacy

1. **Local OCR**: Screen text extraction uses macOS Vision framework locally. No images are sent to cloud services.

2. **Minimal Cloud Data**: Only extracted text and conversation context are sent to LLMs.

3. **Local Storage**: All memories, commands, and screenshots are stored locally.

4. **No Telemetry**: Ghost does not collect or transmit usage data.

### API Security

1. **CORS**: Backend restricts origins to known Dashboard URLs.

2. **Local Network**: Default configuration binds to localhost only.

3. **No Authentication**: Single-user design assumes machine-level trust.

### File Access

1. **Sandboxed Indexing**: File indexing respects user-specified paths.

2. **No Automatic Upload**: Files are never uploaded to external services.

---

## External Integrations

### LLM Providers

| Provider | Models | Purpose |
|----------|--------|---------|
| Google Gemini | gemini-2.0-pro, gemini-2.0-flash | Primary reasoning, extraction |
| OpenRouter | Various | Fallback, alternative models |

### Speech Services

| Service | Purpose | Fallback |
|---------|---------|----------|
| Groq Whisper | Speech-to-text | None (required) |
| ElevenLabs | Text-to-speech | macOS system TTS |

### macOS Integrations

| Framework | Purpose |
|-----------|---------|
| Vision | OCR text extraction |
| EventKit | Apple Reminders |
| CoreAudio | Audio capture |
| screencapture | Screenshot capture |

---

## Configuration Management

### Daemon Configuration

**File**: `apps/ghost/daemon/config.json`

```json
{
  "backendUrl": "http://localhost:4000",
  "activationPort": 3847,
  "voice": {
    "enabled": true,
    "voiceId": "pqHfZKP75CvOlQylNhV4"
  },
  "hotkey": {
    "key": "Space",
    "modifiers": ["Option"]
  },
  "vad": {
    "frameDuration": 96,
    "threshold": 0.5
  }
}
```

### Backend Configuration

**File**: `apps/ghost/backend/.env`

```bash
GEMINI_API_KEY=...
ELEVENLABS_API_KEY=...
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=...
DATABASE_PATH=./ghost.db
MAKER_ENABLED=true
MEMORY_PROVIDER=gemini
```

### Environment Variables

| Variable | Component | Description |
|----------|-----------|-------------|
| `GEMINI_API_KEY` | Backend | Google Gemini API key |
| `ELEVENLABS_API_KEY` | Daemon | ElevenLabs TTS API key |
| `GROQ_API_KEY` | Daemon | Groq Whisper API key |
| `OPENROUTER_API_KEY` | Backend | OpenRouter API key |
| `DATABASE_PATH` | Backend | SQLite database path |
| `MAKER_ENABLED` | Backend | Enable MAKER reliability layer |
| `MEMORY_PROVIDER` | Backend | LLM provider for extraction |

---

## Performance Considerations

### Latency Optimization

1. **Neural VAD**: Sub-100ms speech detection vs 500ms+ with sox.

2. **Parallel Operations**: Screenshot capture runs in parallel with audio recording.

3. **Streaming Responses**: SSE enables word-by-word response display.

4. **Context Caching**: Frequently accessed memories are cached.

### Resource Usage

| Component | Memory | CPU |
|-----------|--------|-----|
| Daemon (idle) | ~150MB | <1% |
| Daemon (active) | ~300MB | 5-10% |
| Backend (idle) | ~100MB | <1% |
| Backend (active) | ~200MB | 10-20% |
| Dashboard | Browser-dependent | Browser-dependent |

---

## Future Considerations

1. **Multi-User Support**: Current single-user design could be extended with authentication.

2. **Cross-Platform**: macOS-specific features (Vision, EventKit) would need platform abstractions.

3. **On-Device LLM**: Local model support for fully offline operation.

4. **Plugin System**: Extensible action system for third-party integrations.
