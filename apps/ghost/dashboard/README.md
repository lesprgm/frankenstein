# Ghost Dashboard

Web-based visualization interface for Ghost daemon activity.

## Setup

1. Install dependencies: `npm install`
2. Run in development: `npm run dev`
3. Build for production: `npm run build`
4. Preview production build: `npm run preview`

## Features

- Real-time command transcript
- Memory visualization with relevance scores
- Action execution status
- System statistics

## Configuration

Set `VITE_API_BASE` to your Ghost backend URL (defaults to `http://localhost:3000`). The dashboard polls every 2 seconds for live updates.
