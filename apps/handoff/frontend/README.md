# Handoff Frontend

React + TypeScript + Vite + Tailwind CSS frontend for the Handoff AI memory application.

## Tech Stack

- **Core**: React 18, TypeScript, Vite
- **Styling**: Tailwind CSS, Headless UI
- **State Management & Data Fetching**: React Query (@tanstack/react-query)
- **Routing**: React Router DOM
- **Markdown Rendering**: React Markdown, Remark GFM
- **Testing**: Vitest, React Testing Library
- **Linting**: ESLint

## Project Structure

The source code is located in the `src` directory:

- `components/`: Reusable UI components
- `pages/`: Application pages/routes
- `hooks/`: Custom React hooks
- `contexts/`: React contexts for global state
- `lib/`: Utility functions and libraries
- `App.tsx`: Main application component
- `main.tsx`: Entry point

## Development

You can run development scripts from the root of the monorepo or from this directory.

### From Monorepo Root

```bash
# Install dependencies
npm install

# Start dev server
npm run dev:frontend

# Build for production
npm run build:frontend

# Deploy to Cloudflare Pages
npm run deploy:frontend

# Lint
npm run lint:frontend
```

### From This Directory (`apps/handoff/frontend`)

```bash
# Start dev server
npm run dev

# Build for production
npm run build

# Run tests
npm run test

# Run tests in watch mode
npm run test:watch

# Lint
npm run lint
```

## Configuration

- **Vite**: Configured in `vite.config.ts`. Uses `@` alias for `src` directory.
- **TypeScript**: Configured in `tsconfig.json`.
- **Tailwind**: Configured in `tailwind.config.js` and `postcss.config.js`.

## Environment Variables

Create a `.env` file in this directory:

```
VITE_API_URL=http://localhost:8787
```

## Development Approach

This frontend is part of the Handoff application, which was developed using Kiro's spec-driven development methodology. See the [main Handoff README](../README.md#development-approach) for complete details on the specification-driven development process and architecture decisions.
