# Implementation Plan

- [x] 1. Set up project structure and dependencies
  - Create monorepo structure with `apps/handoff-frontend` and `apps/handoff-backend`
  - Initialize frontend with Vite + React + TypeScript + Tailwind
  - Initialize backend with Cloudflare Workers + Hono
  - Set up shared types package for frontend/backend
  - Configure build and deployment scripts
  - _Requirements: All (foundation)_

- [x] 2. Implement authentication system
  - Create Supabase auth tables (users, sessions)
  - Implement backend AuthService with signup, login, token verification
  - Use bcrypt for password hashing
  - Generate JWT tokens for authenticated sessions
  - Create frontend AuthContext for auth state management
  - Implement Login and Signup pages
  - Add protected route wrapper
  - _Requirements: 1.1_

- [x] 3. Implement workspace creation on signup
  - Extend signup endpoint to create personal workspace automatically
  - Name workspace after user (e.g., "Alice's Memory")
  - Set workspace type to 'personal'
  - Set user as workspace owner
  - Return workspace in signup response
  - _Requirements: 1.2, 1.3, 1.4, 1.5_

- [x] 4. Implement workspace management backend
  - Create WorkspaceService class
  - Implement createWorkspace() for creating new workspaces
  - Implement getUserWorkspaces() to fetch all user's workspaces
  - Implement addMember() to add users to team workspaces
  - Implement isMember() to check workspace access
  - Create API routes: GET /workspaces, POST /workspaces, POST /workspaces/:id/members
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [x] 5. Implement workspace management frontend
  - Create WorkspaceContext for workspace state
  - Implement WorkspaceSwitcher component with dropdown
  - Display workspace type icon (personal/team)
  - Implement CreateWorkspace modal
  - Store selected workspace in localStorage
  - Update all API calls to include workspaceId
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 6. Implement file import backend
  - Create ImportService class
  - Initialize ChatCapture with auto-detection enabled
  - Implement POST /import endpoint accepting multipart file upload
  - Validate user has access to workspace
  - Parse file using ChatCapture.parseFileAuto()
  - Store conversations via StorageClient with workspace_id
  - Create import job tracking system
  - Return jobId for status polling
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 12.1, 12.2_

- [x] 7. Implement file import frontend
  - Create Import page with file upload UI
  - Implement FileUpload component with drag-and-drop
  - Show file size validation (max 50MB)
  - Implement ImportProgress component
  - Poll GET /import/:jobId for status updates
  - Display import results (conversations count, errors)
  - Handle errors with clear messages
  - _Requirements: 2.1, 2.2, 2.6, 2.7_

- [x] 8. Implement memory extraction backend
  - Initialize MemoryExtractor with OpenAI provider
  - Register 'personal_default' extraction profile (gpt-4o-mini, confidence 0.6)
  - Register 'team_default' extraction profile (gpt-4o, confidence 0.7)
  - Create background job system for extraction
  - Implement extractMemories() that selects profile based on workspace type
  - Extract memories using MemoryExtractor.extractBatch()
  - Store memories via StorageClient
  - Update import job status when complete
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 12.3, 12.5_

- [x] 9. Implement memory timeline backend
  - Create API route GET /memories with workspace scoping
  - Support filtering by type, date range
  - Support search by content
  - Support pagination (limit, offset)
  - Fetch memories via StorageClient.listMemories()
  - Include attribution (importing user) for team workspaces
  - Return total count for pagination
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 13.1, 13.2, 13.3_

- [ ] 10. Implement memory timeline frontend
  - Create Memories page with timeline view
  - Implement MemoryTimeline component with infinite scroll
  - Implement MemoryCard component showing type, content, confidence, timestamp
  - Implement MemoryFilters component (type, date)
  - Implement MemorySearch component
  - Show attribution in team workspaces
  - Link memories to source conversations
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 13.1, 13.2, 13.3_

- [ ] 11. Implement chat backend
  - Initialize ContextEngine with OpenAI embeddings
  - Create ChatService class
  - Implement POST /chat endpoint
  - Validate workspace access
  - Build context using ContextEngine.buildContext() with workspace scoping
  - Use workspace-appropriate token budget (1500 for personal, 2500 for team)
  - Format prompt with context
  - Call OpenAI chat completion API
  - Extract memories from chat exchange
  - Store conversation and memories
  - Return response with context metadata
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 12.3, 12.4_

- [ ] 12. Implement chat frontend
  - Create Chat page with chat interface
  - Implement ChatInterface component
  - Implement MessageList component
  - Implement MessageInput component
  - Implement ContextPanel showing memories used
  - Implement ContextMemoryCard component
  - Display token count and truncation status
  - Link context memories to source conversations
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 13. Implement conversations list backend
  - Create API route GET /conversations with workspace scoping
  - Support filtering by provider
  - Support search by content
  - Support pagination
  - Fetch conversations via StorageClient.listConversations()
  - Include message count and memory count
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 14. Implement conversations list frontend
  - Create Conversations page
  - Implement ConversationsList component
  - Implement ConversationCard showing title, provider, date
  - Implement filters by provider
  - Implement search
  - Create ConversationView page showing full conversation
  - Display messages and extracted memories
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 15. Implement team activity feed backend
  - Create activities table in database
  - Log activity on import, extraction, chat, member_added
  - Create API route GET /activity with workspace scoping
  - Support filtering by user
  - Support pagination
  - Format activity messages
  - _Requirements: 13.4, 13.5_

- [x] 16. Implement team activity feed frontend
  - Create Activity page (only show for team workspaces)
  - Implement ActivityFeed component
  - Implement ActivityItem component
  - Show user name, activity type, timestamp
  - Support filtering by team member
  - Hide activity nav item for personal workspaces
  - _Requirements: 13.4, 13.5_

- [x] 17. Implement data export
  - Create API route POST /export
  - Export conversations as JSON
  - Export memories as JSON
  - Export relationships as JSON
  - Create ZIP file
  - Generate temporary download URL
  - Return URL with expiration
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 18. Implement settings and workspace deletion
  - Create Settings page
  - Implement WorkspaceSettings component
  - Show workspace members for team workspaces
  - Implement DataExport component
  - Implement DeleteWorkspace component with confirmation
  - Create API route DELETE /workspaces/:id
  - Delete all workspace data (conversations, memories, relationships)
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 11.5_

- [x] 19. Implement UI layout and navigation with minimalist design
  - Create Layout component with clean header and sidebar structure
  - Implement Header with workspace switcher and user avatar (right side)
  - Implement Sidebar with only 3-4 navigation items: Import, Memories, Chat, Activity (team only)
  - Add simple workspace type icons (person icon for personal, team icon for team)
  - Conditionally show Activity link only for team workspaces
  - Apply minimalist Tailwind styling:
    - Light background (bg-gray-50 or bg-white)
    - Simple cards with subtle borders (border-gray-200) or very light shadows
    - One accent color for buttons and highlights (e.g., blue-600 or violet-600)
    - Lots of whitespace and clean spacing
    - No gradients, heavy shadows, or complex visual effects
    - Keep context panel and timelines visually simple (no charts or heavy chrome)
  - Use consistent typography (one font family, 2-3 sizes)
  - _Requirements: 10.2, 10.4_

- [x] 20. Implement performance optimizations
  - Add loading states for all async operations
  - Implement optimistic UI updates where possible
  - Cache workspace data in frontend
  - Add infinite scroll for long lists
  - Debounce search inputs
  - Lazy load components
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

- [x] 21. Write frontend component tests
  - Test WorkspaceSwitcher with multiple workspaces
  - Test FileUpload with drag-and-drop
  - Test MemoryTimeline with filtering
  - Test ChatInterface with context panel
  - Test ConversationsList with search
  - _Requirements: All (quality)_

- [x] 22. Write backend integration tests
  - Test signup creates personal workspace
  - Test import with workspace scoping
  - Test memory extraction with correct profile
  - Test chat with context building
  - Test workspace switching updates data
  - Test team workspace member access
  - _Requirements: All (quality)_

- [x] 23. Deploy and configure infrastructure
  - Set up Supabase project and database
  - Create Cloudflare Vectorize index
  - Configure OpenAI API access
  - Deploy backend to Cloudflare Workers
  - Deploy frontend to Cloudflare Pages
  - Configure environment variables
  - Test end-to-end in production
  - _Requirements: All (deployment)_
