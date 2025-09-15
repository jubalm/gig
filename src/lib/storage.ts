import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGunzip, createGzip } from 'node:zlib'

export interface ChargeObject {
	id: string
	summary: string
	units: number
	timestamp: string
	git_commits?: string[]
	parent?: string
	context: string
	state: string
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

		this.ensureDirectories()
	}

	private ensureDirectories() {
		if (!existsSync(this.gigDir)) {
			mkdirSync(this.gigDir, { recursive: true })
		}
		if (!existsSync(this.objectsDir)) {
			mkdirSync(this.objectsDir, { recursive: true })
		}
		if (!existsSync(this.refsDir)) {
			mkdirSync(this.refsDir, { recursive: true })
		}
	}

	/**
	 * Generate SHA-256 hash for content addressing
	 */
	private generateHash(content: string): string {
		return createHash('sha256').update(content).digest('hex')
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
	 * Store a charge object with content addressing
	 */
	async storeCharge(charge: Omit<ChargeObject, 'id'>): Promise<string> {
		const content = JSON.stringify(charge, null, 2)
		const hash = this.generateHash(content)
		const objectPath = this.getObjectPath(hash)

		// Ensure directory exists
		await mkdir(dirname(objectPath), { recursive: true })

		// Atomic write: write to temp file then rename
		const tempPath = `${objectPath}.tmp`

		try {
			// Compress and write
			const writeStream = createWriteStream(tempPath)
			const gzip = createGzip()

			await pipeline([content], gzip, writeStream)

			// Atomic rename
			await rename(tempPath, objectPath)

			return hash
		} catch (error) {
			// Cleanup temp file on error
			try {
				await rename(tempPath, tempPath)
			} catch {}
			throw error
		}
	}

	/**
	 * Retrieve a charge object by its hash
	 */
	async getCharge(hash: string): Promise<ChargeObject | null> {
		const objectPath = this.getObjectPath(hash)

		if (!existsSync(objectPath)) {
			return null
		}

		try {
			// Read and decompress
			const readStream = createReadStream(objectPath)
			const gunzip = createGunzip()

			const chunks: Buffer[] = []

			await pipeline(readStream, gunzip, async function* (source) {
				for await (const chunk of source) {
					chunks.push(chunk)
				}
			})

			const content = Buffer.concat(chunks).toString('utf8')
			const charge = JSON.parse(content) as Omit<ChargeObject, 'id'>

			return {
				id: hash,
				...charge,
			}
		} catch (error) {
			throw new Error(`Failed to read charge ${hash}: ${error}`)
		}
	}

	/**
	 * Update a reference (HEAD pointer for context)
	 */
	async updateRef(context: string, hash: string): Promise<void> {
		const refPath = join(this.refsDir, `${context.replace('/', '_')}`)
		await mkdir(dirname(refPath), { recursive: true })
		await writeFile(refPath, hash)
	}

	/**
	 * Get the HEAD reference for a context
	 */
	async getRef(context: string): Promise<string | null> {
		const refPath = join(this.refsDir, `${context.replace('/', '_')}`)

		if (!existsSync(refPath)) {
			return null
		}

		try {
			const content = await readFile(refPath, 'utf8')
			return content.trim()
		} catch {
			return null
		}
	}

	/**
	 * Get the current context
	 */
	getCurrentContext(): string {
		const currentContextPath = join(this.gigDir, 'current-context')

		if (!existsSync(currentContextPath)) {
			return 'default'
		}

		try {
			return readFileSync(currentContextPath, 'utf8').trim()
		} catch {
			return 'default'
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
	 * Check if a context exists
	 */
	contextExists(context: string): boolean {
		const refPath = join(this.refsDir, `${context.replace('/', '_')}`)
		return existsSync(refPath)
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
		const current = this.getCurrentContext()
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
	 * Update a charge's state in-place (simple approach for MVP)
	 */
	async updateChargeState(chargeId: string, newState: ChargeObject['state']): Promise<void> {
		const charge = await this.getCharge(chargeId)
		if (!charge) {
			throw new Error(`Charge ${chargeId} not found`)
		}

		// Update state in place and re-store
		charge.state = newState
		const objectPath = this.getObjectPath(chargeId)

		// Write updated charge back to the same location
		const content = JSON.stringify({ ...charge, id: undefined }, null, 2)
		const tempPath = `${objectPath}.tmp`

		try {
			const { createWriteStream } = await import('node:fs')
			const { createGzip } = await import('node:zlib')
			const { pipeline } = await import('node:stream/promises')

			const writeStream = createWriteStream(tempPath)
			const gzip = createGzip()

			await pipeline([content], gzip, writeStream)

			await rename(tempPath, objectPath)
		} catch (error) {
			// Cleanup temp file on error
			try {
				await rename(tempPath, tempPath)
			} catch {}
			throw error
		}
	}
}
