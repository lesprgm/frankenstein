# Ghost Dashboard

Web-based visualization interface for Ghost daemon activity.

## Setup

1. Install dependencies: `npm install`
2. Run in development: `npm run dev`
3. Build for production: `npm run build`
4. Preview production build: `npm run preview`

## Features

- Real-time command transcript with SSE token streaming
- Command detail view with full memory graph
- Memory visualization with relevance scores and D3.js force-directed graphs
- Source popup overlay with confidence bars
- Action execution status
- System statistics

## Configuration

Set `VITE_API_BASE` to your Ghost backend URL (defaults to `http://localhost:4000`). The dashboard runs on port 5174 and polls every 2 seconds for live updates.

---

## Development Approach

This dashboard is part of the Ghost application, which was developed using Kiro's spec-driven development methodology. See the [main Ghost README](../README.md#development-approach) for complete details on the specification-driven development process and architecture decisions.
