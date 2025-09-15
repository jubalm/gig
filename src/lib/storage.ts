import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGunzip, createGzip } from 'node:zlib'

// Custom error classes for better error handling
export class StorageError extends Error {
	constructor(
		message: string,
		public cause?: unknown
	) {
		super(message)
		this.name = 'StorageError'
	}
}

export class ChargeNotFoundError extends StorageError {
	constructor(chargeId: string) {
		super(`Charge ${chargeId} not found`)
		this.name = 'ChargeNotFoundError'
	}
}

export class ContextNotFoundError extends StorageError {
	constructor(context: string) {
		super(`Context ${context} not found`)
		this.name = 'ContextNotFoundError'
	}
}

export const CHARGE_STATES = ['unmarked', 'collectible', 'billed', 'paid'] as const
export type ChargeState = (typeof CHARGE_STATES)[number]

export interface ChargeObject {
	id: string
	summary: string
	units: number
	timestamp: string // Should be ISO 8601 format
	git_commits?: readonly string[]
	parent?: string
	context: string
	state: ChargeState
}

export interface ChargeObjectInput extends Omit<ChargeObject, 'id'> {
	// Input type for charge creation with validation
}

export interface StorageRef {
	context: string
	head: string // SHA of latest charge
}

export class Storage {
	private gigDir: string
	private objectsDir: string
	private refsDir: string

	constructor() {
		this.gigDir = process.env.GIG_CONFIG_PATH || join(homedir(), '.gig')
		this.objectsDir = join(this.gigDir, 'objects')
		this.refsDir = join(this.gigDir, 'refs')
		// Remove synchronous directory creation from constructor
		// Lazy initialization will handle this when needed
	}

	/**
	 * Lazy initialization of directories using async I/O
	 * Called only when needed to avoid blocking constructor
	 */
	private async ensureDirectories(): Promise<void> {
		try {
			await mkdir(this.gigDir, { recursive: true })
			await mkdir(this.objectsDir, { recursive: true })
			await mkdir(this.refsDir, { recursive: true })
		} catch (error) {
			// Ignore EEXIST errors - directories already exist
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
				throw new StorageError(`Failed to create storage directories: ${error}`)
			}
		}
	}

	/**
	 * Generate SHA-256 hash for content addressing
	 */
	private generateHash(content: string): string {
		return createHash('sha256').update(content, 'utf8').digest('hex')
	}

	/**
	 * Validate charge input before storing
	 */
	private validateChargeInput(charge: ChargeObjectInput): void {
		if (!charge.summary?.trim()) {
			throw new StorageError('Charge summary is required')
		}
		if (typeof charge.units !== 'number' || charge.units <= 0) {
			throw new StorageError('Charge units must be a positive number')
		}
		if (!CHARGE_STATES.includes(charge.state as ChargeState)) {
			throw new StorageError(`Invalid charge state: ${charge.state}`)
		}
		if (!charge.context?.trim()) {
			throw new StorageError('Charge context is required')
		}
		// Validate ISO 8601 timestamp
		if (!charge.timestamp || Number.isNaN(Date.parse(charge.timestamp))) {
			throw new StorageError('Invalid timestamp format, expected ISO 8601')
		}
	}

	/**
	 * Safely unlink a file, suppressing ENOENT errors
	 */
	private async safeUnlink(filePath: string): Promise<void> {
		try {
			const { unlink } = await import('node:fs/promises')
			await unlink(filePath)
		} catch (error) {
			// Ignore file not found errors
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				console.warn(`Warning: Failed to cleanup temp file ${filePath}:`, error)
			}
		}
	}

	/**
	 * Get the file path for an object by its hash
	 */
	private getObjectPath(hash: string): string {
		const dir = hash.slice(0, 2)
		const file = hash.slice(2)
		return join(this.objectsDir, dir, file)
	}

	/**
	 * Store a charge object with content addressing and validation
	 */
	async storeCharge(charge: ChargeObjectInput): Promise<string> {
		// Validate input
		this.validateChargeInput(charge)

		// Ensure directories exist lazily
		await this.ensureDirectories()

		const content = JSON.stringify(charge, null, 2)
		const hash = this.generateHash(content)
		const objectPath = this.getObjectPath(hash)

		// Check if object already exists (deduplication)
		try {
			await readFile(objectPath)
			return hash // Object already exists
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw new StorageError(`Error checking existing object: ${error}`)
			}
		}

		// Ensure object directory exists
		await mkdir(dirname(objectPath), { recursive: true })

		// Use crypto.randomUUID() for better temp file names
		const { randomUUID } = await import('node:crypto')
		const tempPath = `${objectPath}.tmp.${randomUUID()}`

		try {
			// More efficient compression settings
			const gzip = createGzip({ level: 6, chunkSize: 1024 })
			const writeStream = createWriteStream(tempPath)

			await pipeline([content], gzip, writeStream)
			await rename(tempPath, objectPath)

			return hash
		} catch (error) {
			// Proper cleanup with error suppression
			await this.safeUnlink(tempPath)
			throw new StorageError(`Failed to store charge: ${error}`, error)
		}
	}

	/**
	 * Retrieve a charge object by its hash with error handling
	 */
	async getCharge(hash: string): Promise<ChargeObject | null> {
		const objectPath = this.getObjectPath(hash)

		try {
			const readStream = createReadStream(objectPath)
			const gunzip = createGunzip()

			const chunks: Buffer[] = []

			await pipeline(readStream, gunzip, async (source) => {
				for await (const chunk of source) {
					chunks.push(chunk)
				}
			})

			const content = Buffer.concat(chunks).toString('utf8')
			const chargeData = JSON.parse(content) as ChargeObjectInput

			// Validate loaded data
			this.validateChargeInput(chargeData)

			return {
				id: hash,
				...chargeData,
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return null
			}
			throw new ChargeNotFoundError(hash)
		}
	}

	/**
	 * Update a reference (HEAD pointer for context) with atomic write
	 */
	async updateRef(context: string, hash: string): Promise<void> {
		await this.ensureDirectories()

		const refPath = join(this.refsDir, `${context.replace('/', '_')}`)
		const { randomUUID } = await import('node:crypto')
		const tempPath = `${refPath}.tmp.${randomUUID()}`

		try {
			await writeFile(tempPath, hash, 'utf8')
			await rename(tempPath, refPath)
		} catch (error) {
			await this.safeUnlink(tempPath)
			throw new StorageError(`Failed to update ref for context ${context}: ${error}`, error)
		}
	}

	/**
	 * Get the HEAD reference for a context
	 */
	async getRef(context: string): Promise<string | null> {
		const refPath = join(this.refsDir, `${context.replace('/', '_')}`)

		try {
			const content = await readFile(refPath, 'utf8')
			return content.trim() || null
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return null
			}
			throw new StorageError(`Failed to read ref for context ${context}: ${error}`, error)
		}
	}

	/**
	 * Get the current context (async version to avoid blocking I/O)
	 */
	async getCurrentContext(): Promise<string> {
		const currentContextPath = join(this.gigDir, 'current-context')

		try {
			const content = await readFile(currentContextPath, 'utf8')
			return content.trim() || 'default'
		} catch (error) {
			// Return default if file doesn't exist or can't be read
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return 'default'
			}
			throw new StorageError(`Failed to read current context: ${error}`)
		}
	}

	/**
	 * Set the current context
	 */
	async setCurrentContext(context: string): Promise<void> {
		const currentContextPath = join(this.gigDir, 'current-context')
		await writeFile(currentContextPath, context)
	}

	/**
	 * Check if a context exists (async version)
	 */
	async contextExists(context: string): Promise<boolean> {
		const refPath = join(this.refsDir, `${context.replace('/', '_')}`)
		try {
			await readFile(refPath, 'utf8')
			return true
		} catch (error) {
			return (error as NodeJS.ErrnoException).code !== 'ENOENT'
		}
	}

	/**
	 * Get all contexts
	 */
	async getAllContexts(): Promise<string[]> {
		try {
			const { readdir } = await import('node:fs/promises')
			const files = await readdir(this.refsDir)
			return files.map((file) => file.replace('_', '/'))
		} catch {
			return []
		}
	}

	/**
	 * Walk the charge history from HEAD backwards
	 */
	async *walkHistory(context: string): AsyncGenerator<ChargeObject> {
		let current = await this.getRef(context)

		while (current) {
			const charge = await this.getCharge(current)
			if (!charge) break

			yield charge
			current = charge.parent || null
		}
	}

	/**
	 * Get all charges for a context (helper method)
	 */
	async getAllCharges(context: string): Promise<ChargeObject[]> {
		const charges: ChargeObject[] = []
		for await (const charge of this.walkHistory(context)) {
			charges.push(charge)
		}
		return charges
	}

	/**
	 * Find charges across all contexts (for filtering)
	 */
	async findCharges(filter?: (charge: ChargeObject) => boolean): Promise<ChargeObject[]> {
		const allCharges: ChargeObject[] = []
		const contexts = await this.getAllContexts()

		// Always include current context even if no charges yet
		const current = await this.getCurrentContext()
		if (!contexts.includes(current)) {
			contexts.push(current)
		}

		for (const context of contexts) {
			const charges = await this.getAllCharges(context)
			allCharges.push(...charges)
		}

		return filter ? allCharges.filter(filter) : allCharges
	}

	/**
	 * Update a charge's state by creating a new charge object (preserves immutability)
	 * This maintains the content-addressed storage principle correctly
	 */
	async updateChargeState(chargeId: string, newState: ChargeState): Promise<string> {
		const originalCharge = await this.getCharge(chargeId)
		if (!originalCharge) {
			throw new ChargeNotFoundError(chargeId)
		}

		// Create new charge with updated state (preserves immutability)
		const updatedCharge: ChargeObjectInput = {
			...originalCharge,
			state: newState,
			timestamp: new Date().toISOString(), // Update timestamp for the state change
			parent: chargeId, // Link to the previous version
		}

		// Store the new charge and return its hash
		return this.storeCharge(updatedCharge)
	}
}
