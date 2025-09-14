import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { createInterface } from 'readline';
import { tmpdir } from 'os';
import { join } from 'path';
import { Storage } from './storage';
import type { ChargeObject } from './storage';
import { Config } from './config';
import { GitIntegration } from './git';

export interface CreateChargeOptions {
  summary: string;
  units: number;
  git_commits?: string[];
}

export class ChargeManager {
  private storage: Storage;
  private config: Config;
  private git: GitIntegration;

  constructor(storage: Storage, config: Config, git: GitIntegration) {
    this.storage = storage;
    this.config = config;
    this.git = git;
  }

  /**
   * Create a charge with the provided options
   */
  async createCharge(options: CreateChargeOptions): Promise<string> {
    const context = this.storage.getCurrentContext();

    // Validate units
    if (isNaN(options.units) || options.units <= 0) {
      throw new Error('Units must be a positive number');
    }

    // Validate and process git commits
    const gitCommits = options.git_commits || [];
    const validCommits: string[] = [];

    for (const commit of gitCommits) {
      const { exists } = await this.git.commitExists(commit);
      if (exists) {
        validCommits.push(commit);
      } else {
        console.warn(`Warning: Git commit ${commit} not found in configured repositories`);
      }
    }

    // Get parent charge (HEAD of current context)
    const parent = await this.storage.getRef(context);

    // Create charge object
    const chargeData = {
      summary: options.summary.trim(),
      units: options.units,
      timestamp: new Date().toISOString(),
      git_commits: validCommits.length > 0 ? validCommits : undefined,
      parent: parent || undefined,
      context,
      state: 'unmarked' as const
    };

    // Store the charge
    const chargeId = await this.storage.storeCharge(chargeData);

    // Update HEAD reference for the context
    await this.storage.updateRef(context, chargeId);

    return chargeId;
  }

  /**
   * Create a charge interactively using an editor
   */
  async createChargeInteractive(): Promise<string> {
    const template = await this.git.generateChargeTemplate();
    const editor = process.env.EDITOR || 'vi';

    // Create temporary file
    const tempFile = join(tmpdir(), `gig-charge-${Date.now()}.yml`);
    writeFileSync(tempFile, template);

    try {
      // Open editor
      execSync(`${editor} "${tempFile}"`, { stdio: 'inherit' });

      // Read the edited content
      const content = readFileSync(tempFile, 'utf8');
      const parsed = this.parseChargeTemplate(content);

      // Create the charge
      const chargeId = await this.createCharge({
        summary: parsed.summary,
        units: parsed.units,
        git_commits: parsed.git_commits
      });

      return chargeId;
    } finally {
      // Clean up temp file
      try {
        unlinkSync(tempFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Parse the charge template from editor
   */
  private parseChargeTemplate(content: string): CreateChargeOptions {
    const lines = content.split('\n');
    let summary = '';
    let units = 0;
    let gitCommits: string[] = [];
    let inSummary = false;
    let inGit = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('summary:')) {
        inSummary = true;
        inGit = false;
        const summaryValue = trimmed.substring(8).trim();
        if (summaryValue && !summaryValue.startsWith('|')) {
          summary = summaryValue;
          inSummary = false;
        }
        continue;
      }

      if (trimmed.startsWith('units:')) {
        inSummary = false;
        inGit = false;
        const unitsValue = trimmed.substring(6).trim();
        units = parseFloat(unitsValue) || 0;
        continue;
      }

      if (trimmed.startsWith('git:')) {
        inSummary = false;
        inGit = true;
        continue;
      }

      if (trimmed.startsWith('timestamp:')) {
        inSummary = false;
        inGit = false;
        continue;
      }

      // Handle summary content
      if (inSummary) {
        if (trimmed && !trimmed.startsWith('#')) {
          summary += (summary ? ' ' : '') + trimmed;
        }
        continue;
      }

      // Handle git commits
      if (inGit && trimmed) {
        // Extract commit hash from formats like:
        // - "a1b2c3d: \"commit message\""
        // - "  repo:\n    a1b2c3d: \"message\""
        const commitMatch = trimmed.match(/([a-f0-9]{7,40}):/i);
        if (commitMatch) {
          gitCommits.push(commitMatch[1]);
        }
      }
    }

    if (!summary.trim()) {
      throw new Error('Summary is required');
    }

    if (units <= 0) {
      throw new Error('Units must be a positive number');
    }

    return {
      summary: summary.trim(),
      units,
      git_commits: gitCommits
    };
  }

  /**
   * Mark a charge with a new state
   */
  async markCharge(chargeId: string, newState: ChargeObject['state']): Promise<void> {
    // Validate state
    const validStates = ['unmarked', 'collectible', 'billed', 'paid'];
    if (!validStates.includes(newState)) {
      throw new Error(`Invalid state: ${newState}. Valid states are: ${validStates.join(', ')}`);
    }

    // Check if charge exists
    const charge = await this.storage.getCharge(chargeId);
    if (!charge) {
      throw new Error(`Charge ${chargeId} not found`);
    }

    // Update the charge state
    await this.storage.updateChargeState(chargeId, newState);

    console.log(`Updated charge ${chargeId.slice(0, 7)} to state: ${newState}`);
  }

  /**
   * Get a charge by ID
   */
  async getCharge(chargeId: string): Promise<ChargeObject | null> {
    return this.storage.getCharge(chargeId);
  }

  /**
   * Get charge history for the current context
   */
  async getChargeHistory(context?: string): Promise<ChargeObject[]> {
    const targetContext = context || this.storage.getCurrentContext();
    return this.storage.getAllCharges(targetContext);
  }

  /**
   * Search for charges by partial ID
   */
  async findChargeById(partialId: string): Promise<ChargeObject[]> {
    const allCharges = await this.storage.findCharges();
    return allCharges.filter(charge => charge.id.startsWith(partialId));
  }

  /**
   * Get charge summary for display
   */
  async getChargeSummary(chargeId: string): Promise<string> {
    const charge = await this.storage.getCharge(chargeId);
    if (!charge) {
      return `Charge ${chargeId.slice(0, 7)} not found`;
    }

    const rate = await this.config.getRate(charge.context);
    const amount = rate ? (charge.units * rate).toFixed(2) : 'N/A';

    let summary = `Charge ${charge.id.slice(0, 7)}: ${charge.summary}\n`;
    summary += `Context: ${charge.context}\n`;
    summary += `Units: ${charge.units}\n`;
    summary += `Amount: $${amount}\n`;
    summary += `State: ${charge.state}\n`;
    summary += `Timestamp: ${charge.timestamp}\n`;

    if (charge.git_commits && charge.git_commits.length > 0) {
      summary += `Git commits: ${charge.git_commits.map(c => c.slice(0, 7)).join(', ')}\n`;
    }

    return summary;
  }

  /**
   * Validate charge data
   */
  private validateChargeData(data: Partial<CreateChargeOptions>): void {
    if (!data.summary || data.summary.trim().length === 0) {
      throw new Error('Summary is required');
    }

    if (!data.units || isNaN(data.units) || data.units <= 0) {
      throw new Error('Units must be a positive number');
    }
  }

  /**
   * Show charge creation help
   */
  showChargeHelp(): void {
    console.log(`
Charge Creation Help:

Quick mode:
  gig charge -m "Built authentication system" -u 3

Editor mode:
  gig charge
  (Opens $EDITOR with template including recent git commits)

Template format:
  summary: |
    Your work description here
  units: 2.5
  git:
    a1b2c3d: "Commit message"
    b2c3d4e: "Another commit"
  timestamp: "2025-09-12T14:30:00Z"

Tips:
- Summary describes the work completed
- Units can be hours, story points, or any measure you prefer
- Git commits are automatically detected from configured repositories
- Use 'gig config repositories' to configure repositories
`);
  }

  /**
   * Interactive charge creation wizard
   */
  async createChargeWizard(): Promise<string> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });

    try {
      const summary = await this.askQuestion(rl, 'Summary of work completed: ');
      if (!summary.trim()) {
        throw new Error('Summary is required');
      }

      const unitsStr = await this.askQuestion(rl, 'Units (hours, points, etc.): ');
      const units = parseFloat(unitsStr);
      if (isNaN(units) || units <= 0) {
        throw new Error('Units must be a positive number');
      }

      const includeCommits = await this.askQuestion(rl, 'Include recent git commits? (y/n): ');
      let gitCommits: string[] = [];

      if (includeCommits.toLowerCase().startsWith('y')) {
        const recentCommits = await this.git.getRecentCommits(5);
        if (recentCommits.length > 0) {
          console.log('\nRecent commits:');
          recentCommits.forEach((commit, index) => {
            console.log(`${index + 1}. ${commit.hash.slice(0, 7)} - ${commit.subject}`);
          });

          const selection = await this.askQuestion(rl, 'Select commits (comma-separated numbers, or "all"): ');
          if (selection.toLowerCase() === 'all') {
            gitCommits = recentCommits.map(c => c.hash);
          } else {
            const indices = selection.split(',').map(s => parseInt(s.trim()) - 1);
            gitCommits = indices
              .filter(i => i >= 0 && i < recentCommits.length)
              .map(i => recentCommits[i].hash);
          }
        }
      }

      return this.createCharge({ summary, units, git_commits: gitCommits });
    } finally {
      rl.close();
    }
  }

  /**
   * Helper to ask a question via readline
   */
  private askQuestion(rl: any, question: string): Promise<string> {
    return new Promise(resolve => {
      rl.question(question, (answer: string) => {
        resolve(answer);
      });
    });
  }
}