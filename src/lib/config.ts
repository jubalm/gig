import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { WorkspaceManager } from './context'

// Custom error class for configuration errors
export class ConfigError extends Error {
	constructor(
		message: string,
		public cause?: unknown
	) {
		super(message)
		this.name = 'ConfigError'
	}
}

type ConfigValue = string | number | boolean
type ConfigData = {
	[key: string]: ConfigValue | ConfigData | ConfigValue[]
}

interface ContextConfig {
	rate?: number
	client?: string
	repositories?: readonly string[]
	[key: string]: ConfigValue | ConfigValue[] | undefined
}

interface UserConfig {
	name?: string
	email?: string
}

interface GlobalConfig {
	user?: UserConfig
	context?: ContextConfig
	[key: string]: ConfigValue | object | undefined
}

export class Config {
	private gigDir: string
	private globalConfigPath: string
	private contextManager: WorkspaceManager

	constructor(contextManager: WorkspaceManager) {
		this.contextManager = contextManager
		this.gigDir = process.env.GIG_CONFIG_PATH || join(homedir(), '.gig')
		this.globalConfigPath = join(this.gigDir, 'config.json')
		// Remove synchronous directory creation from constructor
	}

	/**
	 * Ensure gig directory exists (async version)
	 */
	private async ensureGigDirectory(): Promise<void> {
		try {
			await mkdir(this.gigDir, { recursive: true })
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
				throw new ConfigError(`Failed to create config directory: ${error}`)
			}
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
	 * Load configuration from a file (async version)
	 */
	private async loadConfig(filePath: string): Promise<ConfigData> {
		try {
			const content = await readFile(filePath, 'utf8')
			return JSON.parse(content)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return {} // File doesn't exist, return empty config
			}
			throw new ConfigError(`Failed to parse config file ${filePath}: ${error}`)
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
	private async loadGlobalConfig(): Promise<GlobalConfig> {
		return (await this.loadConfig(this.globalConfigPath)) as GlobalConfig
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
	private async loadContextConfig(context: string): Promise<ContextConfig> {
		const contextConfigPath = this.getContextConfigPath(context)
		return (await this.loadConfig(contextConfigPath)) as ContextConfig
	}

	/**
	 * Save context-specific configuration
	 */
	private async saveContextConfig(context: string, config: ContextConfig): Promise<void> {
		const contextConfigPath = this.getContextConfigPath(context)
		await this.saveConfig(contextConfigPath, config)
	}

	/**
	 * Set a configuration value with validation
	 */
	async set(key: string, value: ConfigValue, global = false): Promise<void> {
		if (!key?.trim()) {
			throw new ConfigError('Configuration key cannot be empty')
		}

		const parsedValue = this.parseValue(value)

		// Ensure directory exists before writing
		await this.ensureGigDirectory()

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
	async get(key: string, context?: string): Promise<ConfigValue | undefined> {
		const targetContext = context || (await this.contextManager.getCurrentWorkspace())

		// Try context-specific config first
		const contextValue = await this.getContextValue(targetContext, key)
		if (contextValue !== undefined) {
			return contextValue
		}

		// Fall back to global config
		const globalValue = await this.getGlobalValue(key)
		if (globalValue !== undefined) {
			return globalValue
		}

		return undefined
	}

	/**
	 * Set a global configuration value
	 */
	private async setGlobalValue(key: string, value: ConfigValue): Promise<void> {
		const config = await this.loadGlobalConfig()
		this.setNestedValue(config, key, value)
		await this.saveGlobalConfig(config)
	}

	/**
	 * Get a global configuration value
	 */
	private async getGlobalValue(key: string): Promise<ConfigValue | undefined> {
		const config = await this.loadGlobalConfig()
		return this.getNestedValue(config, key)
	}

	/**
	 * Set a context-specific configuration value
	 */
	private async setContextValue(context: string, key: string, value: ConfigValue): Promise<void> {
		const config = await this.loadContextConfig(context)
		this.setNestedValue(config, key, value)
		await this.saveContextConfig(context, config)
	}

	/**
	 * Get a context-specific configuration value
	 */
	private async getContextValue(context: string, key: string): Promise<ConfigValue | undefined> {
		const config = await this.loadContextConfig(context)
		return this.getNestedValue(config, key)
	}

	/**
	 * Set a nested value in a config object using dot notation
	 */
	private setNestedValue(config: ConfigData, key: string, value: ConfigValue): void {
		const parts = key.split('.')
		let current = config

		for (let i = 0; i < parts.length - 1; i++) {
			const part = parts[i]
			if (!(part in current) || typeof current[part] !== 'object' || Array.isArray(current[part])) {
				current[part] = {}
			}
			current = current[part] as ConfigData
		}

		current[parts[parts.length - 1]] = value
	}

	/**
	 * Get a nested value from a config object using dot notation
	 */
	private getNestedValue(config: ConfigData, key: string): ConfigValue | undefined {
		const parts = key.split('.')
		let current: ConfigData | ConfigValue | ConfigValue[] = config

		for (const part of parts) {
			if (
				current === null ||
				current === undefined ||
				typeof current !== 'object' ||
				Array.isArray(current)
			) {
				return undefined
			}
			current = (current as ConfigData)[part]
		}

		return typeof current === 'string' ||
			typeof current === 'number' ||
			typeof current === 'boolean'
			? current
			: undefined
	}

	/**
	 * Parse a value to appropriate type with better validation
	 */
	private parseValue(value: ConfigValue): ConfigValue {
		if (typeof value !== 'string') {
			return value
		}

		const trimmed = value.trim()
		if (!trimmed) {
			return trimmed
		}

		// Try to parse as number
		if (/^-?\d*\.?\d+$/.test(trimmed)) {
			const num = Number(trimmed)
			if (Number.isFinite(num)) {
				return num
			}
		}

		// Try to parse as boolean
		const lower = trimmed.toLowerCase()
		if (lower === 'true') return true
		if (lower === 'false') return false

		return trimmed
	}

	/**
	 * List all configuration keys and values for current context
	 */
	async list(context?: string): Promise<Record<string, ConfigValue>> {
		const targetContext = context || (await this.contextManager.getCurrentWorkspace())
		const result: Record<string, ConfigValue> = {}

		// Get global config
		const globalConfig = await this.loadGlobalConfig()
		this.flattenConfig(globalConfig, result, 'global')

		// Get context config (overrides global)
		const contextConfig = await this.loadContextConfig(targetContext)
		this.flattenConfig(contextConfig, result, `context.${targetContext}`)

		return result
	}

	/**
	 * Flatten a nested config object for display
	 */
	private flattenConfig(
		config: ConfigData,
		result: Record<string, ConfigValue>,
		prefix: string
	): void {
		for (const [key, value] of Object.entries(config)) {
			const fullKey = `${prefix}.${key}`

			if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
				this.flattenConfig(value as ConfigData, result, fullKey)
			} else if (Array.isArray(value)) {
				// Handle arrays as comma-separated strings for display
				result[fullKey] = value.join(', ')
			} else {
				result[fullKey] = value as ConfigValue
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
