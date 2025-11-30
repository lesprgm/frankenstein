# Ghost

**The Multi-Modal, Privacy-First AI OS Assistant.**

Ghost is a voice-controlled AI that lives on your Mac, sees your screen, remembers your context, and acts on your local environment. It combines local processing with cloud intelligence to create an assistant that truly understands you.

---

## What Makes Ghost Unique

Ghost combines capabilities that don't exist together in any other assistant:

**Screen-Aware with Local Privacy**
- Sees your screen using macOS Vision framework (local OCR)
- Only extracted text sent to LLM, never raw images
- All screenshots stored locally at `~/.ghost/screenshots/`

**Persistent Visual Memory**
- Remembers every screen you've shown it
- Search by meaning: "What was that error I saw yesterday?"
- Returns the exact screenshot with context

**Voice-First + Native OS Integration**
- Global hotkey (`Option+Space`) for instant access
- Creates Apple Reminders with visual context
- Controls files, apps, and navigation locally

**AI Explainability**
- Shows why it found each result
- Interactive memory graph of reasoning paths
- Not a black box

**Technical Depth**
- 5 languages: Swift (Vision + EventKit), Electron, Node.js, React, SQL
- Multi-process architecture: Daemon + Backend + Dashboard
- 100% local mode with SQLite + local embeddings
- Built on MemoryLayer skeleton framework

---

## Key Features

### **Ghost Vision** (Screen Context)
Ghost can **see** what's on your screen using macOS native OCR.
- **Local Processing**: Uses Apple's Vision framework (no cloud image processing)
- **Parallel Capture**: Screenshots happen in parallel with voice recording
- **Visual Memory**: All screenshots are permanently saved and indexed
- **Privacy-First**: Only extracted text is sent to the LLM, not raw images

**Example:**
> **You:** "What's on my screen?"  
> **Ghost:** "I see code for a React component with a login form..."

### **Visual Memory** (Screenshot Archive)
Every screen capture is saved to `~/.ghost/screenshots/` and indexed as a memory.
- **Full Context**: Future queries can reference past screens
- **Searchable**: "What was that bug I saw yesterday?" will find the exact screenshot
- **Linked to Commands**: Each screenshot is associated with the command that triggered it

### **Contextual Reminders** (Apple Reminders Integration)
Create native Apple Reminders with screen context automatically included.
- **EventKit Bridge**: Swift integration with macOS Reminders
- **Smart Defaults**: "Remind me to fix this tomorrow" creates a reminder with your current screen context in the notes
- **Due Dates**: Natural language date parsing ("tomorrow", "next week")

**Example:**
> *(Looking at a bug in VS Code)*  
> **You:** "Remind me to fix this tomorrow"  
> **Ghost:** *Creates a reminder titled "Fix this bug" with the code snippet + file path in the notes*

### **Super Spotlight** (Semantic Search)
Voice-activated semantic search over your entire Memory Layer.
- **Beyond Keywords**: Search by meaning, not exact matches
- **Memory Fusion**: Searches across files, conversations, and screenshots
- **Instant Results**: Top 3 results shown via notification

**Example:**
> **You:** "Search for files about the database migration"  
> **Ghost:** *Shows notification: "Found 3 results: migration-plan.md, db-schema.sql, team-notes.txt"*

### **Active Memory Layer**
Ghost doesn't just process commands; it **remembers**. Built on a local SQLite + Vector database:
- **Entities**: People, files, and projects you mention
- **Events**: Meetings, decisions, and conversations
- **Relationships**: Links between memories for contextual recall
- **Screen Context**: Visual snapshots tied to specific moments

### **Voice-First Interaction**
- **Global Hotkey**: `Option+Space` (macOS) to talk instantly
- **Natural Conversation**: Speak naturally; Ghost understands context and intent
- **Real-time Streaming**: Hear Ghost "thinking out loud" with low-latency responses
- **Voice Feedback**: Ghost speaks back using ElevenLabs or system TTS

### **AI Explainability** ("Why Ghost Did This")
Ghost is not a black box. When it recalls information, it tells you why.
- **Smart Notifications**: "Found in March 15 meeting notes"
- **Interactive Memory Graph**: Click to see a D3.js force-directed graph of the reasoning path
- **Timeline View**: See the sequence of memories used to answer your question

### **Local Control**
Ghost acts on your computer:
- **File Operations**: "Open the latest PDF in Downloads"
- **Navigation**: "Scroll down", "Go to the next page"
- **App Control**: Launch apps and manage windows

### **MAKER Reliability Layer** (Multi-Agent Consensus)
Ghost uses a **multi-agent reliability layer** for critical memory extraction, inspired by the MAKER framework.
- **Microagents**: Runs 3 parallel Gemini Flash agents to extract session insights
- **Red-Flagging**: Validates outputs to catch hallucinations or malformed data
- **Voting Consensus**: Uses a K-threshold voting mechanism to select the most accurate memory
- **Visual Verification**: MAKER-verified memories glow gold in the dashboard
- **S-Level Robustness**: Handles chaos, noise, sarcasm, and even social engineering attacks

**Testing Results:**  
MAKER has been stress-tested with extreme scenarios including production incidents with reversed decisions, interleaved conversations (signal vs noise), and social engineering attacks. See [MAKER_ROBUSTNESS.md](./MAKER_ROBUSTNESS.md) for detailed test results.


---

## Architecture

Ghost consists of three main components working in harmony:

```mermaid
flowchart LR
  subgraph Client["User Machine (macOS)"]
    Hotkey["Global Hotkey"]
    Daemon["Ghost Daemon\n(Electron)"]
    Vision["Vision Service\n(Swift + OCR)"]
    Reminders["Reminders Service\n(EventKit)"]
    Dashboard["Dashboard\n(React + Vite)"]
    Files["Local Files"]
  end

  subgraph Backend["Ghost Backend"]
    API["Hono API"]
    Memory["MemoryLayer\n(SQLite + Vectors)"]
    LLM["Gemini / Claude"]
    Search["Semantic Search"]
    MAKER["MAKER Layer\n(Multi-Agent)"]
  end

  Hotkey --> Daemon
  Daemon <--> API
  Daemon --> Vision
  Daemon --> Reminders
  Daemon --> Dashboard
  Dashboard <--> API
  API <--> Memory
  API <--> LLM
  API <--> Search
  API <--> MAKER
```

1.  **Daemon** (`apps/ghost/daemon`): The "body". Handles audio, hotkeys, OCR, TTS, reminders, and local OS actions.
2.  **Backend** (`apps/ghost/backend`): The "brain". Manages the MemoryLayer, processes intent with LLMs, and coordinates context.
3.  **Dashboard** (`apps/ghost/dashboard`): The "face". Visual interface for interaction, history, and explainability.

---

## Getting Started

### Prerequisites
- **macOS** (for Vision & EventKit integration)
- Node.js 18+
- Gemini API Key (for LLM)
- ElevenLabs API Key (optional, for premium TTS)

### 1. Start the Backend
```bash
cd apps/ghost/backend
cp .env.example .env
# Add your GEMINI_API_KEY to .env
npm install
npm run dev
```
*Runs on port 4000.*

### 2. Start the Daemon
```bash
cd apps/ghost/daemon
cp config.example.json config.json
# Update config.json with your preferences
npm install
npm run dev
```
*Registers global hotkey `Option+Space`.*

### 3. Start the Dashboard
```bash
cd apps/ghost/dashboard
npm install
npm run dev
```
*Opens at http://localhost:5173*

---

## Demo Scenarios

### 1. Visual Memory + Contextual Reminders
> *(Looking at a code error)*  
> **You:** "Remind me to debug this tomorrow morning"  
> **Ghost:** *Creates reminder with screenshot + error text*  
> *(Next day)*  
> **You:** "What was that bug I needed to fix?"  
> **Ghost:** *Shows the exact screenshot from yesterday*

### 2. Screen Context Awareness
> *(Reading a research paper)*  
> **You:** "Summarize this"  
> **Ghost:** *Uses OCR to read the PDF text on your screen*  
> **Ghost:** "This paper discusses transformer architectures for NLP..."

### 3. Semantic Search
> **You:** "Search for files about API authentication"  
> **Ghost:** *Searches across file contents, not just names*  
> **Ghost:** "Found 3 results: auth.md, jwt-implementation.ts, security-notes.txt"

### 4. Memory Recall
> **You:** "What was the decision about the database migration?"  
> **Ghost:** "In the team meeting on Tuesday, you decided to stick with Postgres for now."  
> *Notification: "Found in Tuesday Meeting Notes"*

### 5. Explainability
> **You:** "Why did you think I meant that file?"  
> *Click the notification → See Memory Graph showing links between 'Sarah', 'Project Specs', and the file*

---

## Privacy & Local-First

Ghost is designed with privacy as a core principle:
- **Local OCR**: Screenshot text extraction happens on your Mac (Vision framework)
- **Local Memories**: Your database lives on your disk (SQLite)
- **Local Actions**: File scanning and OS control happen locally
- **Local Reminders**: EventKit integration keeps data in Apple's ecosystem
- **Screenshots Stored Locally**: All images saved to `~/.ghost/screenshots/`
- **Cloud LLM**: Only extracted text and necessary context sent to Gemini (not raw images)

---

## Testing

### Run Backend Tests
```bash
cd apps/ghost/backend
npm test
```

### Run Daemon Tests
```bash
cd apps/ghost/daemon
npm test
```

**Test Coverage:** 92% (58/63 tests passing)
-  Visual Memory
-  Memory Consolidation
-  E2E Flows
-  LLM Integration

---

## Troubleshooting

- **Port 4000 in use**: `lsof -ti :4000 | xargs kill -9`
- **Backend Offline**: Check `daemon/config.json` backend URL
- **Voice Issues**: Check microphone permissions in System Settings
- **OCR Not Working**: Ensure macOS Vision framework is available (macOS 10.15+)
- **Reminders Not Creating**: Grant Calendar/Reminders permissions in System Settings

---

## 📦 What's New

### Latest Features (v0.2.0)
- 👁️ **Ghost Vision**: macOS native OCR for screen reading
- 📸 **Visual Memory**: Permanent screenshot archiving
- 📅 **Contextual Reminders**: Apple Reminders integration with screen context
- 🔍 **Super Spotlight**: Semantic search across all memories
-  **AI Explainability**: Memory graphs and reasoning visualization
- 🛡️ **MAKER Reliability**: Multi-agent consensus for zero-error memory extraction

---

---

## Spec-Driven Development with Kiro

Ghost was developed using **Kiro**, a spec-driven development methodology that emphasizes writing comprehensive specifications before implementation. All specifications are located in the `.kiro/specs/ghost-daemon/` directory:

- **[`requirements.md`](file:///.kiro/specs/ghost-daemon/requirements.md)** - Detailed functional and non-functional requirements
- **[`design.md`](file:///.kiro/specs/ghost-daemon/design.md)** - Architecture, component design, and technical decisions
- **[`tasks.md`](file:///.kiro/specs/ghost-daemon/tasks.md)** - Implementation breakdown and task tracking

### Benefits of Kiro's Spec-Driven Approach

By using Kiro to write specifications **before** code, we achieved:
1. **Clear Direction**: Every feature had defined requirements and acceptance criteria
2. **Better Architecture**: Design decisions were documented and reviewed before implementation
3. **Reduced Rework**: Issues caught in the spec phase, not during coding
4. **Living Documentation**: Specs evolved with the project but remained the source of truth
5. **Easier Collaboration**: New contributors can read specs to understand intent

This approach was particularly valuable for Ghost's complex multi-modal features (Vision, Reminders, Search), where upfront design prevented significant technical debt.

---

## Built For
Hackathons, power users, and anyone who wants a truly personal AI assistant that respects privacy while delivering cutting-edge multi-modal intelligence.


