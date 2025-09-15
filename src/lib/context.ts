import type { Storage } from './storage'

export class WorkspaceManager {
	private storage: Storage

	constructor(storage: Storage) {
		this.storage = storage
	}

	/**
	 * Get the current workspace
	 */
	async getCurrentWorkspace(): Promise<string> {
		return this.storage.getCurrentContext()
	}

	/**
	 * Switch to a different workspace
	 */
	async switchWorkspace(context: string): Promise<void> {
		// Validate workspace format
		if (!this.isValidContextName(context)) {
			throw new Error(
				`Invalid workspace name: ${context}. Use format like 'client/project' or 'default'`
			)
		}

		// Check if workspace exists (unless it's default)
		if (context !== 'default' && !this.storage.contextExists(context)) {
			throw new Error(
				`Workspace '${context}' does not exist. Use 'gig switch -c ${context}' to create it.`
			)
		}

		await this.storage.setCurrentContext(context)
	}

	/**
	 * Create a new workspace and switch to it
	 */
	async createWorkspace(context: string): Promise<void> {
		// Validate workspace format
		if (!this.isValidContextName(context)) {
			throw new Error(
				`Invalid workspace name: ${context}. Use format like 'client/project' or 'default'`
			)
		}

		// Check if workspace already exists
		if (this.storage.contextExists(context)) {
			throw new Error(`Workspace '${context}' already exists`)
		}

		// Create the workspace by initializing a ref (even if empty)
		// This creates the ref file which marks the workspace as existing
		await this.storage.updateRef(context, '')

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
	 * Check if a workspace exists
	 */
	workspaceExists(context: string): boolean {
		if (context === 'default') {
			return true // Default always exists
		}
		return this.storage.contextExists(context)
	}

	/**
	 * Validate workspace name format
	 */
	private isValidContextName(context: string): boolean {
		// Allow alphanumeric, hyphens, underscores, forward slashes, and @
		// Examples: default, client/project, @org/project, client-name/project_name
		const validPattern = /^[a-zA-Z0-9@_-]+(?:\/[a-zA-Z0-9@_-]+)*$/

		// Must not be empty
		if (!context || context.length === 0) {
			return false
		}

		// Must not start or end with slash
		if (context.startsWith('/') || context.endsWith('/')) {
			return false
		}

		// Must not have consecutive slashes
		if (context.includes('//')) {
			return false
		}

		return validPattern.test(context)
	}

	/**
	 * Get workspace information including charge count
	 */
	async getWorkspaceInfo(context?: string): Promise<{
		name: string
		current: boolean
		chargeCount: number
		lastCharge?: string
	}> {
		const targetContext = context || (await this.getCurrentWorkspace())
		const currentContext = await this.getCurrentWorkspace()

		const charges = await this.storage.getAllCharges(targetContext)
		const lastCharge = charges.length > 0 ? charges[0] : undefined

		return {
			name: targetContext,
			current: targetContext === currentContext,
			chargeCount: charges.length,
			lastCharge: lastCharge?.summary,
		}
	}

	/**
	 * Get all workspaces with their information
	 */
	async getAllWorkspacesInfo(): Promise<
		Array<{
			name: string
			current: boolean
			chargeCount: number
			lastCharge?: string
		}>
	> {
		const contexts = await this.listWorkspaces()
		const contextInfos = []

		for (const context of contexts) {
			const info = await this.getWorkspaceInfo(context)
			contextInfos.push(info)
		}

		return contextInfos
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
	 * Parse workspace patterns for filtering
	 * Supports wildcards like @acme-* or client/*
	 */
	parseWorkspacePattern(pattern: string): RegExp {
		// Escape special regex characters except * and ?
		const escaped = pattern.replace(/[.+^${}()|[\\]\\]/g, '\\$&')

		// Replace wildcards
		const regexPattern = escaped
			.replace(/\*/g, '.*') // * becomes .*
			.replace(/\?/g, '.') // ? becomes .

		return new RegExp(`^${regexPattern}$`)
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
