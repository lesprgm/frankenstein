import Database from 'better-sqlite3';

/**
 * Single-user manager for Ghost
 * Simplifies MemoryLayer's multi-user concepts for single-user use
 * Auto-creates default user and workspace
 */
export class SingleUserManager {
    private db: Database.Database;
    private defaultUserId: string = 'ghost-user';
    private defaultWorkspaceId: string = 'ghost-workspace';

    constructor(db: Database.Database) {
        this.db = db;
    }

    /**
     * Initialize default user and workspace
     * Called on app startup
     */
    async initialize(): Promise<{ userId: string; workspaceId: string }> {
        // Check if default user exists
        const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(this.defaultUserId);

        if (!user) {
            // Create default user
            this.db.prepare(`
        INSERT INTO users (id, email, name, created_at, updated_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
      `).run(this.defaultUserId, 'ghost@local', 'Ghost User');

            console.log('Created default Ghost user');
        }

        // Check if default workspace exists
        const workspace = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(this.defaultWorkspaceId);

        if (!workspace) {
            // Create default workspace
            this.db.prepare(`
        INSERT INTO workspaces (id, name, type, owner_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(this.defaultWorkspaceId, 'Ghost Workspace', 'personal', this.defaultUserId);

            console.log('Created default Ghost workspace');
        }

        return {
            userId: this.defaultUserId,
            workspaceId: this.defaultWorkspaceId,
        };
    }

    /**
     * Get default user ID
     */
    getUserId(): string {
        return this.defaultUserId;
    }

    /**
     * Get default workspace ID
     */
    getWorkspaceId(): string {
        return this.defaultWorkspaceId;
    }

    /**
     * Map Ghost's user_id to workspace_id
     * For now, all users map to the same workspace
     */
    mapUserToWorkspace(userId: string): string {
        return this.defaultWorkspaceId;
    }
}
