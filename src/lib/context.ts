import type { Storage } from './storage'

// Enhanced error types for workspace operations
export class WorkspaceError extends Error {
	constructor(
		message: string,
		public readonly operation: string,
		public readonly workspace?: string
	) {
		super(message)
		this.name = 'WorkspaceError'
	}
}

export class WorkspaceValidationError extends WorkspaceError {
	constructor(workspace: string, reason: string) {
		super(`Invalid workspace name '${workspace}': ${reason}`, 'validation', workspace)
		this.name = 'WorkspaceValidationError'
	}
}

export class WorkspaceNotFoundError extends WorkspaceError {
	constructor(workspace: string) {
		super(`Workspace '${workspace}' does not exist`, 'not-found', workspace)
		this.name = 'WorkspaceNotFoundError'
	}
}

// Type-safe workspace information
export interface WorkspaceInfo {
	readonly name: string
	readonly current: boolean
	readonly chargeCount: number
	readonly lastCharge?: string
	readonly lastModified?: Date
}

// Workspace validation patterns
const WORKSPACE_PATTERNS = {
	VALID_CHARS: /^[a-zA-Z0-9@_-]+(?:\/[a-zA-Z0-9@_-]+)*$/,
	RESERVED_NAMES: new Set(['default', 'HEAD', 'refs', 'objects']),
	MAX_LENGTH: 200,
	MAX_SEGMENTS: 5,
} as const

export class WorkspaceManager {
	private storage: Storage
	private workspaceCache = new Map<string, { exists: boolean; timestamp: number }>()
	private readonly CACHE_TTL_MS = 10000 // 10 seconds

	constructor(storage: Storage) {
		this.storage = storage
	}

	/**
	 * Get the current workspace
	 */
	async getCurrentWorkspace(): Promise<string> {
		return await this.storage.getCurrentContext()
	}

	/**
	 * Switch to a different workspace
	 */
	async switchWorkspace(context: string): Promise<void> {
		// Validate workspace format
		this.validateWorkspaceName(context)

		// Check if workspace exists
		const exists = await this.workspaceExistsWithCache(context)
		if (!exists) {
			throw new WorkspaceNotFoundError(context)
		}

		await this.storage.setCurrentContext(context)
	}

	/**
	 * Create a new workspace and switch to it
	 */
	async createWorkspace(context: string): Promise<void> {
		// Validate workspace format
		this.validateWorkspaceName(context)

		// Check if workspace already exists
		const exists = await this.workspaceExistsWithCache(context)
		if (exists) {
			throw new WorkspaceError(`Workspace '${context}' already exists`, 'create', context)
		}

		// Create the workspace by initializing a ref (even if empty)
		// This creates the ref file which marks the workspace as existing
		await this.storage.updateRef(context, '')

		// Invalidate cache for this workspace
		this.workspaceCache.delete(context)

		// Switch to the new workspace
		await this.storage.setCurrentContext(context)
	}

	/**
	 * List all workspaces
	 */
	async listWorkspaces(): Promise<string[]> {
		const contexts = await this.storage.getAllContexts()

		// Always include default workspace
		if (!contexts.includes('default')) {
			contexts.unshift('default')
		}

		return contexts.sort()
	}

	/**
	 * Check if a workspace exists (synchronous version for backward compatibility)
	 * Note: This method may not reflect the most current state due to async storage operations
	 */
	workspaceExists(context: string): boolean {
		if (context === 'default') {
			return true // Default always exists
		}

		// Check cache first for better accuracy
		const cached = this.workspaceCache.get(context)
		if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
			return cached.exists
		}

		// Fallback to synchronous check (may be outdated)
		// This is a compatibility method - prefer workspaceExistsAsync for accurate results
		try {
			// Since contextExists is async, we can't provide accurate sync results
			// Return false to be safe and encourage using the async version
			return false
		} catch {
			return false
		}
	}

	/**
	 * Check if a workspace exists (async version with caching)
	 */
	async workspaceExistsAsync(context: string): Promise<boolean> {
		return this.workspaceExistsWithCache(context)
	}

	/**
	 * Validate workspace name format with comprehensive checks
	 */
	private validateWorkspaceName(context: string): void {
		// Check if empty or undefined
		if (!context || context.length === 0) {
			throw new WorkspaceValidationError(context, 'workspace name cannot be empty')
		}

		// Check length limits
		if (context.length > WORKSPACE_PATTERNS.MAX_LENGTH) {
			throw new WorkspaceValidationError(
				context,
				`workspace name too long (max ${WORKSPACE_PATTERNS.MAX_LENGTH} characters)`
			)
		}

		// Check segment count
		const segments = context.split('/')
		if (segments.length > WORKSPACE_PATTERNS.MAX_SEGMENTS) {
			throw new WorkspaceValidationError(
				context,
				`too many path segments (max ${WORKSPACE_PATTERNS.MAX_SEGMENTS})`
			)
		}

		// Check for reserved names
		if (WORKSPACE_PATTERNS.RESERVED_NAMES.has(context.toLowerCase())) {
			throw new WorkspaceValidationError(context, 'workspace name is reserved')
		}

		// Check for invalid path patterns
		if (context.startsWith('/') || context.endsWith('/')) {
			throw new WorkspaceValidationError(context, 'workspace name cannot start or end with "/"')
		}

		// Check for consecutive slashes
		if (context.includes('//')) {
			throw new WorkspaceValidationError(context, 'workspace name cannot contain consecutive "/"')
		}

		// Check character patterns
		if (!WORKSPACE_PATTERNS.VALID_CHARS.test(context)) {
			throw new WorkspaceValidationError(
				context,
				'workspace name contains invalid characters (use only a-z, A-Z, 0-9, @, _, -, /)'
			)
		}

		// Check individual segments
		for (const segment of segments) {
			if (segment.length === 0) {
				throw new WorkspaceValidationError(context, 'workspace segments cannot be empty')
			}
			if (segment.startsWith('-') || segment.endsWith('-')) {
				throw new WorkspaceValidationError(
					context,
					'workspace segments cannot start or end with "-"'
				)
			}
		}
	}

	/**
	 * Check if workspace exists with caching
	 */
	private async workspaceExistsWithCache(context: string): Promise<boolean> {
		const now = Date.now()
		const cached = this.workspaceCache.get(context)

		// Return cached result if still valid
		if (cached && now - cached.timestamp < this.CACHE_TTL_MS) {
			return cached.exists
		}

		// Check storage and cache result
		const exists = context === 'default' || (await this.storage.contextExists(context))
		this.workspaceCache.set(context, { exists, timestamp: now })

		return exists
	}

	/**
	 * Get workspace information including charge count
	 */
	async getWorkspaceInfo(context?: string): Promise<WorkspaceInfo> {
		const targetContext = context || (await this.getCurrentWorkspace())
		const currentContext = await this.getCurrentWorkspace()

		const charges = await this.storage.getAllCharges(targetContext)
		const lastCharge = charges.length > 0 ? charges[0] : undefined

		return {
			name: targetContext,
			current: targetContext === currentContext,
			chargeCount: charges.length,
			lastCharge: lastCharge?.summary,
			lastModified: lastCharge ? new Date(lastCharge.timestamp) : undefined,
		}
	}

	/**
	 * Get all workspaces with their information (parallel execution for performance)
	 */
	async getAllWorkspacesInfo(): Promise<WorkspaceInfo[]> {
		const contexts = await this.listWorkspaces()

		// Process workspaces in parallel for better performance
		const infoPromises = contexts.map((context) =>
			this.getWorkspaceInfo(context).catch((error) => {
				console.error(`Failed to get info for workspace ${context}:`, error)
				// Return minimal info on error to not break Promise.all
				return {
					name: context,
					current: false,
					chargeCount: 0,
					lastCharge: undefined,
					lastModified: undefined,
				} as WorkspaceInfo
			})
		)

		return Promise.all(infoPromises)
	}

	/**
	 * Delete a workspace (removes all references but keeps charges in objects)
	 */
	async deleteWorkspace(context: string): Promise<void> {
		if (context === 'default') {
			throw new Error('Cannot delete the default workspace')
		}

		if (!this.storage.contextExists(context)) {
			throw new Error(`Workspace '${context}' does not exist`)
		}

		const currentContext = await this.getCurrentWorkspace()
		if (currentContext === context) {
			throw new Error('Cannot delete the current workspace. Switch to another workspace first.')
		}

		// Note: In a full implementation, we'd remove the ref file here
		// For now, we'll throw an error suggesting the user manually delete
		throw new Error(
			'Workspace deletion not yet implemented. Manually remove the ref file if needed.'
		)
	}

	/**
	 * Parse workspace patterns for filtering with enhanced security
	 * Supports wildcards like @acme-* or client/*
	 */
	parseWorkspacePattern(pattern: string): RegExp {
		// Validate pattern length to prevent ReDoS attacks
		if (pattern.length > 100) {
			throw new WorkspaceValidationError(pattern, 'pattern too long (max 100 characters)')
		}

		// Escape special regex characters except * and ?
		const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')

		// Replace wildcards with length-limited patterns
		const regexPattern = escaped
			.replace(/\*/g, '[^/]*') // * becomes [^/]* (don't cross directory boundaries)
			.replace(/\?/g, '[^/]') // ? becomes [^/] (single char, no slash)

		try {
			return new RegExp(`^${regexPattern}$`)
		} catch (error) {
			throw new WorkspaceValidationError(pattern, `invalid regex pattern: ${error}`)
		}
	}

	/**
	 * Find workspaces matching a pattern
	 */
	async findWorkspacesMatching(pattern: string): Promise<string[]> {
		const allContexts = await this.listWorkspaces()
		const regex = this.parseWorkspacePattern(pattern)

		return allContexts.filter((context) => regex.test(context))
	}
}
