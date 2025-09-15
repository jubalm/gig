import { exec } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { Config } from './config'

const execAsync = promisify(exec)

// Type-safe git command execution result
interface GitCommandResult {
	stdout: string
	stderr: string
	success: boolean
	error?: Error
}

type GitCommitData = Record<string, string | Record<string, string>>

export interface GitCommit {
	hash: string
	subject: string
	author: string
	date: string
	repository: string
}

// Enhanced error types for better debugging
export class GitError extends Error {
	constructor(
		message: string,
		public readonly command: string,
		public readonly repository: string,
		public readonly stderr?: string
	) {
		super(message)
		this.name = 'GitError'
	}
}

export class GitRepositoryError extends GitError {
	constructor(repository: string) {
		super(`Invalid or inaccessible git repository: ${repository}`, 'repository-check', repository)
		this.name = 'GitRepositoryError'
	}
}

// Cache for git repository validation (reduces filesystem checks)
const repoValidationCache = new Map<string, { isValid: boolean; timestamp: number }>()
const CACHE_TTL_MS = 30000 // 30 seconds

export class GitIntegration {
	private config: Config

	constructor(config: Config) {
		this.config = config
	}

	/**
	 * Check if a directory is a git repository with caching
	 */
	private isGitRepository(path: string): boolean {
		const now = Date.now()
		const cached = repoValidationCache.get(path)

		// Return cached result if still valid
		if (cached && now - cached.timestamp < CACHE_TTL_MS) {
			return cached.isValid
		}

		const gitDir = join(path, '.git')
		const isValid = existsSync(gitDir)

		// Cache the result
		repoValidationCache.set(path, { isValid, timestamp: now })
		return isValid
	}

	/**
	 * Execute git command with proper error handling and timeout
	 */
	private async executeGitCommand(
		command: string,
		repoPath: string,
		timeout = 5000
	): Promise<GitCommandResult> {
		try {
			const { stdout, stderr } = await execAsync(command, {
				cwd: repoPath,
				encoding: 'utf8',
				timeout,
				maxBuffer: 1024 * 1024, // 1MB buffer limit
			})

			return {
				stdout: stdout.trim(),
				stderr: stderr.trim(),
				success: true,
			}
		} catch (error) {
			const err = error as Error & { stdout?: string; stderr?: string }
			return {
				stdout: err.stdout || '',
				stderr: err.stderr || err.message,
				success: false,
				error: err,
			}
		}
	}

	/**
	 * Validate and parse git commit line with type safety
	 */
	private parseCommitLine(line: string, repository: string): GitCommit | null {
		if (!line.trim()) return null

		const parts = line.split('|')
		if (parts.length !== 4) {
			console.warn(`Invalid git log format in ${repository}: expected 4 parts, got ${parts.length}`)
			return null
		}

		const [hash, subject, author, date] = parts

		// Validate required fields
		if (!hash?.trim() || !subject?.trim()) {
			console.warn(`Invalid commit data in ${repository}: missing hash or subject`)
			return null
		}

		// Validate commit hash format
		if (!this.isValidCommitHash(hash.trim())) {
			console.warn(`Invalid commit hash format in ${repository}: ${hash}`)
			return null
		}

		return {
			hash: hash.trim(),
			subject: subject.trim(),
			author: author?.trim() || 'Unknown',
			date: date?.trim() || '',
			repository,
		}
	}

	/**
	 * Get recent commits from a git repository (async with proper error handling)
	 */
	private async getCommitsFromRepo(repoPath: string, count = 10): Promise<GitCommit[]> {
		const resolvedPath = resolve(repoPath)

		if (!this.isGitRepository(resolvedPath)) {
			return []
		}

		// Optimize git command for performance
		const gitCommand = `git log --oneline --format="%H|%s|%an|%ad" --date=iso --no-merges -n ${count}`

		const result = await this.executeGitCommand(gitCommand, resolvedPath)

		if (!result.success) {
			// Log error for debugging but don't crash
			console.error(`Failed to get commits from ${repoPath}: ${result.stderr}`)
			return []
		}

		const commits: GitCommit[] = []
		const lines = result.stdout.split('\n')

		for (const line of lines) {
			const commit = this.parseCommitLine(line, repoPath)
			if (commit) {
				commits.push(commit)
			}
		}

		return commits
	}

	/**
	 * Get recent commits from all configured repositories (parallel execution)
	 */
	async getRecentCommits(count = 10): Promise<GitCommit[]> {
		const repositories = await this.config.getRepositories()

		if (repositories.length === 0) {
			// If no repositories configured, try current directory
			const currentDir = process.cwd()
			if (this.isGitRepository(currentDir)) {
				return this.getCommitsFromRepo(currentDir, count)
			}
			return []
		}

		// Execute git operations in parallel for better performance
		const commitPromises = repositories.map((repo) =>
			this.getCommitsFromRepo(repo, count).catch((error) => {
				console.error(`Failed to get commits from ${repo}:`, error)
				return [] // Return empty array on error to not break Promise.all
			})
		)

		const allCommitsArrays = await Promise.all(commitPromises)
		const allCommits = allCommitsArrays.flat()

		// Sort by date (most recent first) and limit to requested count
		return allCommits
			.sort((a, b) => {
				const dateA = new Date(a.date).getTime()
				const dateB = new Date(b.date).getTime()
				return dateB - dateA
			})
			.slice(0, count)
	}

	/**
	 * Get commits from a specific repository
	 */
	async getCommitsFromRepository(repoPath: string, count = 10): Promise<GitCommit[]> {
		return this.getCommitsFromRepo(repoPath, count)
	}

	/**
	 * Check if a commit exists in any configured repository (parallel search)
	 */
	async commitExists(commitHash: string): Promise<{ exists: boolean; repository?: string }> {
		// Validate commit hash format early
		if (!this.isValidCommitHash(commitHash)) {
			return { exists: false }
		}

		const repositories = await this.config.getRepositories()
		// Include current directory if no repos configured
		const reposToCheck = repositories.length > 0 ? repositories : [process.cwd()]

		// Check all repositories in parallel
		const checkPromises = reposToCheck.map(async (repo) => {
			const resolvedPath = resolve(repo)
			if (!this.isGitRepository(resolvedPath)) {
				return null
			}

			// Use git cat-file for faster existence check
			const result = await this.executeGitCommand(
				`git cat-file -e ${commitHash}`,
				resolvedPath,
				2000 // 2 second timeout for existence check
			)

			return result.success ? repo : null
		})

		const results = await Promise.all(checkPromises)
		const foundRepo = results.find((repo) => repo !== null)

		return foundRepo ? { exists: true, repository: foundRepo } : { exists: false }
	}

	/**
	 * Get commit details by hash
	 */
	async getCommitDetails(commitHash: string): Promise<GitCommit | null> {
		const { exists, repository } = await this.commitExists(commitHash)

		if (!exists || !repository) {
			return null
		}

		const resolvedPath = resolve(repository)
		const result = await this.executeGitCommand(
			`git show --no-patch --format="%H|%s|%an|%ad" --date=iso ${commitHash}`,
			resolvedPath
		)

		if (!result.success) {
			console.error(`Failed to get commit details for ${commitHash}:`, result.stderr)
			return null
		}

		return this.parseCommitLine(result.stdout, repository)
	}

	/**
	 * Generate a template with recent commits for charge creation
	 */
	async generateChargeTemplate(): Promise<string> {
		const commits = await this.getRecentCommits(10)
		const repositories = await this.config.getRepositories()

		let template = `summary: |\n  \nunits: \n`

		if (commits.length > 0) {
			template += `git:\n`

			if (repositories.length > 1) {
				// Group commits by repository
				const commitsByRepo = commits.reduce(
					(acc, commit) => {
						const repoName = this.getRepoName(commit.repository)
						if (!acc[repoName]) {
							acc[repoName] = []
						}
						acc[repoName].push(commit)
						return acc
					},
					{} as Record<string, GitCommit[]>
				)

				for (const [repoName, repoCommits] of Object.entries(commitsByRepo)) {
					template += `  ${repoName}:\n`
					for (const commit of repoCommits.slice(0, 5)) {
						template += `    ${commit.hash.slice(0, 7)}: "${commit.subject}"\n`
					}
				}
			} else {
				// Single repository, simpler format
				for (const commit of commits.slice(0, 10)) {
					template += `  ${commit.hash.slice(0, 7)}: "${commit.subject}"\n`
				}
			}
		}

		template += `timestamp: "${new Date().toISOString()}"\n`

		return template
	}

	/**
	 * Extract a simple repository name from a path
	 */
	private getRepoName(repoPath: string): string {
		const normalized = repoPath.replace(/\/$/, '') // Remove trailing slash
		const parts = normalized.split('/')
		return parts[parts.length - 1] || 'repo'
	}

	/**
	 * Validate and extract commit hashes from charge git data
	 */
	async validateCommits(gitData: GitCommitData | null | undefined): Promise<string[]> {
		if (!gitData || typeof gitData !== 'object') {
			return []
		}

		const commits: string[] = []

		// Handle different git data formats
		if (typeof gitData === 'object') {
			for (const [key, value] of Object.entries(gitData)) {
				if (typeof value === 'object' && value !== null) {
					// Multiple repositories format
					for (const [commitHash] of Object.entries(value)) {
						if (this.isValidCommitHash(commitHash)) {
							commits.push(commitHash)
						}
					}
				} else if (this.isValidCommitHash(key)) {
					// Simple format with commit hash as key
					commits.push(key)
				}
			}
		}

		// Validate that commits exist
		const validCommits: string[] = []
		for (const commit of commits) {
			const { exists } = await this.commitExists(commit)
			if (exists) {
				validCommits.push(commit)
			}
		}

		return validCommits
	}

	/**
	 * Check if a string looks like a valid git commit hash
	 */
	private isValidCommitHash(hash: string): boolean {
		// Git commit hashes are 7-40 character hexadecimal strings
		return /^[a-f0-9]{7,40}$/i.test(hash)
	}

	/**
	 * Add current directory as a repository if it's a git repo
	 */
	async addCurrentDirectoryIfGitRepo(): Promise<boolean> {
		const currentDir = process.cwd()

		if (this.isGitRepository(currentDir)) {
			await this.config.addRepository(currentDir)
			return true
		}

		return false
	}

	/**
	 * List all configured repositories with their status (optimized with parallel checks)
	 */
	async listRepositories(): Promise<
		Array<{
			path: string
			exists: boolean
			isGitRepo: boolean
			commitCount?: number
			lastCommitDate?: string
		}>
	> {
		const repositories = await this.config.getRepositories()

		// Process repositories in parallel for better performance
		const repoPromises = repositories.map(async (repo) => {
			const resolvedPath = resolve(repo)
			const exists = existsSync(resolvedPath)
			const isGitRepo = exists ? this.isGitRepository(resolvedPath) : false

			let commitCount: number | undefined
			let lastCommitDate: string | undefined

			if (isGitRepo) {
				try {
					// Use more efficient git command for count
					const countResult = await this.executeGitCommand(
						'git rev-list --count HEAD',
						resolvedPath,
						3000
					)

					if (countResult.success) {
						commitCount = parseInt(countResult.stdout.trim(), 10) || 0
					}

					// Get last commit date
					const dateResult = await this.executeGitCommand(
						'git log -1 --format="%ad" --date=iso',
						resolvedPath,
						2000
					)

					if (dateResult.success) {
						lastCommitDate = dateResult.stdout.trim()
					}
				} catch (error) {
					console.warn(`Failed to get repository stats for ${repo}:`, error)
					commitCount = 0
				}
			}

			return {
				path: repo,
				exists,
				isGitRepo,
				commitCount,
				lastCommitDate,
			}
		})

		return Promise.all(repoPromises)
	}
}
