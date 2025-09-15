import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Config } from './config'

export interface GitCommit {
	hash: string
	subject: string
	author: string
	date: string
	repository: string
}

export class GitIntegration {
	private config: Config

	constructor(config: Config) {
		this.config = config
	}

	/**
	 * Check if a directory is a git repository
	 */
	private isGitRepository(path: string): boolean {
		const gitDir = join(path, '.git')
		return existsSync(gitDir)
	}

	/**
	 * Get recent commits from a git repository
	 */
	private getCommitsFromRepo(repoPath: string, count = 10): GitCommit[] {
		try {
			const resolvedPath = resolve(repoPath)

			if (!this.isGitRepository(resolvedPath)) {
				return []
			}

			// Get recent commits using git log
			const gitCommand = `git log --oneline --format="%H|%s|%an|%ad" --date=iso -n ${count}`
			const output = execSync(gitCommand, {
				cwd: resolvedPath,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore'], // Ignore stderr to suppress git warnings
			})

			const commits: GitCommit[] = []
			const lines = output.trim().split('\n')

			for (const line of lines) {
				if (!line.trim()) continue

				const [hash, subject, author, date] = line.split('|')
				if (hash && subject) {
					commits.push({
						hash: hash.trim(),
						subject: subject.trim(),
						author: author?.trim() || 'Unknown',
						date: date?.trim() || '',
						repository: repoPath,
					})
				}
			}

			return commits
		} catch (_error) {
			// Silently ignore errors (repo might not exist, no commits, etc.)
			return []
		}
	}

	/**
	 * Get recent commits from all configured repositories
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

		const allCommits: GitCommit[] = []

		for (const repo of repositories) {
			const commits = this.getCommitsFromRepo(repo, count)
			allCommits.push(...commits)
		}

		// Sort by date (most recent first) and limit to requested count
		return allCommits
			.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
			.slice(0, count)
	}

	/**
	 * Get commits from a specific repository
	 */
	async getCommitsFromRepository(repoPath: string, count = 10): Promise<GitCommit[]> {
		return this.getCommitsFromRepo(repoPath, count)
	}

	/**
	 * Check if a commit exists in any configured repository
	 */
	async commitExists(commitHash: string): Promise<{ exists: boolean; repository?: string }> {
		const repositories = await this.config.getRepositories()

		// Include current directory if no repos configured
		const reposToCheck = repositories.length > 0 ? repositories : [process.cwd()]

		for (const repo of reposToCheck) {
			try {
				const resolvedPath = resolve(repo)
				if (!this.isGitRepository(resolvedPath)) {
					continue
				}

				// Try to show the commit
				execSync(`git show --no-patch ${commitHash}`, {
					cwd: resolvedPath,
					stdio: ['ignore', 'ignore', 'ignore'],
				})

				return { exists: true, repository: repo }
			} catch {}
		}

		return { exists: false }
	}

	/**
	 * Get commit details by hash
	 */
	async getCommitDetails(commitHash: string): Promise<GitCommit | null> {
		const { exists, repository } = await this.commitExists(commitHash)

		if (!exists || !repository) {
			return null
		}

		try {
			const resolvedPath = resolve(repository)
			const output = execSync(
				`git show --no-patch --format="%H|%s|%an|%ad" --date=iso ${commitHash}`,
				{
					cwd: resolvedPath,
					encoding: 'utf8',
					stdio: ['ignore', 'pipe', 'ignore'],
				}
			)

			const line = output.trim()
			const [hash, subject, author, date] = line.split('|')

			return {
				hash: hash.trim(),
				subject: subject.trim(),
				author: author?.trim() || 'Unknown',
				date: date?.trim() || '',
				repository,
			}
		} catch {
			return null
		}
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
	async validateCommits(gitData: any): Promise<string[]> {
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
	 * List all configured repositories with their status
	 */
	async listRepositories(): Promise<
		Array<{
			path: string
			exists: boolean
			isGitRepo: boolean
			commitCount?: number
		}>
	> {
		const repositories = await this.config.getRepositories()
		const result = []

		for (const repo of repositories) {
			const resolvedPath = resolve(repo)
			const exists = existsSync(resolvedPath)
			const isGitRepo = exists ? this.isGitRepository(resolvedPath) : false

			let commitCount: number | undefined
			if (isGitRepo) {
				try {
					const commits = this.getCommitsFromRepo(resolvedPath, 1000)
					commitCount = commits.length
				} catch {
					commitCount = 0
				}
			}

			result.push({
				path: repo,
				exists,
				isGitRepo,
				commitCount,
			})
		}

		return result
	}
}
