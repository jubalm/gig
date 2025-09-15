import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { WorkspaceManager } from './context'

interface ConfigData {
	[key: string]: string | number | boolean | ConfigData
}

interface ContextConfig {
	rate?: number
	client?: string
	repositories?: string[]
	[key: string]: any
}

interface GlobalConfig {
	user?: {
		name?: string
		email?: string
	}
	context?: ContextConfig
	[key: string]: any
}

export class Config {
	private gigDir: string
	private globalConfigPath: string
	private contextManager: WorkspaceManager

	constructor(contextManager: WorkspaceManager) {
		this.contextManager = contextManager
		this.gigDir = process.env.GIG_CONFIG_PATH || join(homedir(), '.gig')
		this.globalConfigPath = join(this.gigDir, 'config.json')

		this.ensureGigDirectory()
	}

	private ensureGigDirectory() {
		if (!existsSync(this.gigDir)) {
			mkdirSync(this.gigDir, { recursive: true })
		}
	}

	/**
	 * Get the config file path for a context
	 */
	private getContextConfigPath(context: string): string {
		const contextDir = join(this.gigDir, 'contexts', context.replace('/', '_'))
		return join(contextDir, 'config.json')
	}

	/**
	 * Load configuration from a file
	 */
	private loadConfig(filePath: string): ConfigData {
		if (!existsSync(filePath)) {
			return {}
		}

		try {
			const content = readFileSync(filePath, 'utf8')
			return JSON.parse(content)
		} catch (error) {
			throw new Error(`Failed to parse config file ${filePath}: ${error}`)
		}
	}

	/**
	 * Save configuration to a file
	 */
	private async saveConfig(filePath: string, config: ConfigData): Promise<void> {
		const dir = dirname(filePath)
		await mkdir(dir, { recursive: true })

		const content = JSON.stringify(config, null, 2)
		await writeFile(filePath, content)
	}

	/**
	 * Load global configuration
	 */
	private loadGlobalConfig(): GlobalConfig {
		return this.loadConfig(this.globalConfigPath) as GlobalConfig
	}

	/**
	 * Save global configuration
	 */
	private async saveGlobalConfig(config: GlobalConfig): Promise<void> {
		await this.saveConfig(this.globalConfigPath, config)
	}

	/**
	 * Load context-specific configuration
	 */
	private loadContextConfig(context: string): ContextConfig {
		const contextConfigPath = this.getContextConfigPath(context)
		return this.loadConfig(contextConfigPath) as ContextConfig
	}

	/**
	 * Save context-specific configuration
	 */
	private async saveContextConfig(context: string, config: ContextConfig): Promise<void> {
		const contextConfigPath = this.getContextConfigPath(context)
		await this.saveConfig(contextConfigPath, config)
	}

	/**
	 * Set a configuration value
	 */
	async set(key: string, value: string | number | boolean, global = false): Promise<void> {
		const parsedValue = this.parseValue(value)

		if (global) {
			await this.setGlobalValue(key, parsedValue)
		} else {
			const currentContext = await this.contextManager.getCurrentWorkspace()
			await this.setContextValue(currentContext, key, parsedValue)
		}
	}

	/**
	 * Get a configuration value with hierarchy: context -> global -> default
	 */
	async get(key: string, context?: string): Promise<string | number | boolean | undefined> {
		const targetContext = context || (await this.contextManager.getCurrentWorkspace())

		// Try context-specific config first
		const contextValue = this.getContextValue(targetContext, key)
		if (contextValue !== undefined) {
			return contextValue
		}

		// Fall back to global config
		const globalValue = this.getGlobalValue(key)
		if (globalValue !== undefined) {
			return globalValue
		}

		// Return undefined if not found
		return undefined
	}

	/**
	 * Set a global configuration value
	 */
	private async setGlobalValue(key: string, value: string | number | boolean): Promise<void> {
		const config = this.loadGlobalConfig()
		this.setNestedValue(config, key, value)
		await this.saveGlobalConfig(config)
	}

	/**
	 * Get a global configuration value
	 */
	private getGlobalValue(key: string): string | number | boolean | undefined {
		const config = this.loadGlobalConfig()
		return this.getNestedValue(config, key)
	}

	/**
	 * Set a context-specific configuration value
	 */
	private async setContextValue(
		context: string,
		key: string,
		value: string | number | boolean
	): Promise<void> {
		const config = this.loadContextConfig(context)
		this.setNestedValue(config, key, value)
		await this.saveContextConfig(context, config)
	}

	/**
	 * Get a context-specific configuration value
	 */
	private getContextValue(context: string, key: string): string | number | boolean | undefined {
		const config = this.loadContextConfig(context)
		return this.getNestedValue(config, key)
	}

	/**
	 * Set a nested value in a config object using dot notation
	 */
	private setNestedValue(config: ConfigData, key: string, value: string | number | boolean): void {
		const parts = key.split('.')
		let current = config

		for (let i = 0; i < parts.length - 1; i++) {
			const part = parts[i]
			if (!(part in current) || typeof current[part] !== 'object') {
				current[part] = {}
			}
			current = current[part] as ConfigData
		}

		current[parts[parts.length - 1]] = value
	}

	/**
	 * Get a nested value from a config object using dot notation
	 */
	private getNestedValue(config: ConfigData, key: string): string | number | boolean | undefined {
		const parts = key.split('.')
		let current: any = config

		for (const part of parts) {
			if (current === null || current === undefined || typeof current !== 'object') {
				return undefined
			}
			current = current[part]
		}

		return typeof current === 'string' ||
			typeof current === 'number' ||
			typeof current === 'boolean'
			? current
			: undefined
	}

	/**
	 * Parse a string value to appropriate type
	 */
	private parseValue(value: string | number | boolean): string | number | boolean {
		if (typeof value !== 'string') {
			return value
		}

		// Try to parse as number
		const num = parseFloat(value)
		if (!Number.isNaN(num) && Number.isFinite(num) && value.trim() === num.toString()) {
			return num
		}

		// Try to parse as boolean
		const lower = value.toLowerCase()
		if (lower === 'true') return true
		if (lower === 'false') return false

		// Return as string
		return value
	}

	/**
	 * List all configuration keys and values for current context
	 */
	async list(context?: string): Promise<Record<string, string | number | boolean>> {
		const targetContext = context || (await this.contextManager.getCurrentWorkspace())
		const result: Record<string, string | number | boolean> = {}

		// Get global config
		const globalConfig = this.loadGlobalConfig()
		this.flattenConfig(globalConfig, result, 'global')

		// Get context config (overrides global)
		const contextConfig = this.loadContextConfig(targetContext)
		this.flattenConfig(contextConfig, result, `context.${targetContext}`)

		return result
	}

	/**
	 * Flatten a nested config object for display
	 */
	private flattenConfig(
		config: ConfigData,
		result: Record<string, string | number | boolean>,
		prefix: string
	): void {
		for (const [key, value] of Object.entries(config)) {
			const fullKey = `${prefix}.${key}`

			if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
				this.flattenConfig(value as ConfigData, result, fullKey)
			} else {
				result[fullKey] = value as string | number | boolean
			}
		}
	}

	/**
	 * Get repositories for the current context
	 */
	async getRepositories(context?: string): Promise<string[]> {
		const repos = await this.get('repositories', context)
		if (Array.isArray(repos)) {
			return repos
		}
		if (typeof repos === 'string') {
			// Split space-separated repository paths
			return repos.split(/\s+/).filter((path) => path.length > 0)
		}
		return []
	}

	/**
	 * Set repositories for the current context
	 */
	async setRepositories(repositories: string[], global = false): Promise<void> {
		await this.set('repositories', repositories.join(' '), global)
	}

	/**
	 * Add a repository to the current context
	 */
	async addRepository(repoPath: string, global = false): Promise<void> {
		const currentRepos = await this.getRepositories()
		if (!currentRepos.includes(repoPath)) {
			currentRepos.push(repoPath)
			await this.setRepositories(currentRepos, global)
		}
	}

	/**
	 * Remove a repository from the current context
	 */
	async removeRepository(repoPath: string, global = false): Promise<void> {
		const currentRepos = await this.getRepositories()
		const filtered = currentRepos.filter((repo) => repo !== repoPath)
		await this.setRepositories(filtered, global)
	}

	/**
	 * Get the hourly rate for the current context
	 */
	async getRate(context?: string): Promise<number | undefined> {
		const rate = await this.get('rate', context)
		return typeof rate === 'number' ? rate : undefined
	}

	/**
	 * Get the client name for the current context
	 */
	async getClient(context?: string): Promise<string | undefined> {
		const client = await this.get('client', context)
		return typeof client === 'string' ? client : undefined
	}
}
