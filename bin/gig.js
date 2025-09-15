#!/usr/bin/env node

// src/index.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { dirname as dirname3, join as join5 } from "node:path";
import { fileURLToPath } from "node:url";

// src/lib/charge.ts
import { execSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
var ChargeManager = class {
  storage;
  config;
  git;
  constructor(storage, config, git) {
    this.storage = storage;
    this.config = config;
    this.git = git;
  }
  /**
   * Create a charge with the provided options
   */
  async createCharge(options) {
    const context = await this.storage.getCurrentContext();
    if (Number.isNaN(options.units) || options.units <= 0) {
      throw new Error("Units must be a positive number");
    }
    const gitCommits = options.git_commits || [];
    const validCommits = [];
    for (const commit of gitCommits) {
      const { exists } = await this.git.commitExists(commit);
      if (exists) {
        validCommits.push(commit);
      } else {
        console.warn(`Warning: Git commit ${commit} not found in configured repositories`);
      }
    }
    const parent = await this.storage.getRef(context);
    const chargeData = {
      summary: options.summary.trim(),
      units: options.units,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      git_commits: validCommits.length > 0 ? validCommits : void 0,
      parent: parent || void 0,
      context,
      state: "unmarked"
    };
    const chargeId = await this.storage.storeCharge(chargeData);
    await this.storage.updateRef(context, chargeId);
    return chargeId;
  }
  /**
   * Create a charge interactively using an editor
   */
  async createChargeInteractive() {
    const template = await this.git.generateChargeTemplate();
    const editor = process.env.EDITOR || "vi";
    const tempFile = join(tmpdir(), `gig-charge-${Date.now()}.yml`);
    writeFileSync(tempFile, template);
    try {
      execSync(`${editor} "${tempFile}"`, { stdio: "inherit" });
      const content = readFileSync(tempFile, "utf8");
      const parsed = this.parseChargeTemplate(content);
      const chargeId = await this.createCharge({
        summary: parsed.summary,
        units: parsed.units,
        git_commits: parsed.git_commits
      });
      return chargeId;
    } finally {
      try {
        unlinkSync(tempFile);
      } catch {
      }
    }
  }
  /**
   * Parse the charge template from editor
   */
  parseChargeTemplate(content) {
    const lines = content.split("\n");
    let summary = "";
    let units = 0;
    const gitCommits = [];
    let inSummary = false;
    let inGit = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("summary:")) {
        inSummary = true;
        inGit = false;
        const summaryValue = trimmed.substring(8).trim();
        if (summaryValue && !summaryValue.startsWith("|")) {
          summary = summaryValue;
          inSummary = false;
        }
        continue;
      }
      if (trimmed.startsWith("units:")) {
        inSummary = false;
        inGit = false;
        const unitsValue = trimmed.substring(6).trim();
        units = parseFloat(unitsValue) || 0;
        continue;
      }
      if (trimmed.startsWith("git:")) {
        inSummary = false;
        inGit = true;
        continue;
      }
      if (trimmed.startsWith("timestamp:")) {
        inSummary = false;
        inGit = false;
        continue;
      }
      if (inSummary) {
        if (trimmed && !trimmed.startsWith("#")) {
          summary += (summary ? " " : "") + trimmed;
        }
        continue;
      }
      if (inGit && trimmed) {
        const commitMatch = trimmed.match(/([a-f0-9]{7,40}):/i);
        if (commitMatch) {
          gitCommits.push(commitMatch[1]);
        }
      }
    }
    if (!summary.trim()) {
      throw new Error("Summary is required");
    }
    if (units <= 0) {
      throw new Error("Units must be a positive number");
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
  async markCharge(chargeId, newState) {
    const validStates = ["unmarked", "collectible", "billed", "paid"];
    if (!validStates.includes(newState)) {
      throw new Error(`Invalid state: ${newState}. Valid states are: ${validStates.join(", ")}`);
    }
    const charge = await this.storage.getCharge(chargeId);
    if (!charge) {
      throw new Error(`Charge ${chargeId} not found`);
    }
    await this.storage.updateChargeState(chargeId, newState);
    console.log(`Updated charge ${chargeId.slice(0, 7)} to state: ${newState}`);
  }
  /**
   * Get a charge by ID
   */
  async getCharge(chargeId) {
    return this.storage.getCharge(chargeId);
  }
  /**
   * Get charge history for the current context
   */
  async getChargeHistory(context) {
    const targetContext = context || await this.storage.getCurrentContext();
    return this.storage.getAllCharges(targetContext);
  }
  /**
   * Search for charges by partial ID
   */
  async findChargeById(partialId) {
    const allCharges = await this.storage.findCharges();
    return allCharges.filter((charge) => charge.id.startsWith(partialId));
  }
  /**
   * Get charge summary for display
   */
  async getChargeSummary(chargeId) {
    const charge = await this.storage.getCharge(chargeId);
    if (!charge) {
      return `Charge ${chargeId.slice(0, 7)} not found`;
    }
    const rate = await this.config.getRate(charge.context);
    const amount = rate ? (charge.units * rate).toFixed(2) : "N/A";
    let summary = `Charge ${charge.id.slice(0, 7)}: ${charge.summary}
`;
    summary += `Context: ${charge.context}
`;
    summary += `Units: ${charge.units}
`;
    summary += `Amount: $${amount}
`;
    summary += `State: ${charge.state}
`;
    summary += `Timestamp: ${charge.timestamp}
`;
    if (charge.git_commits && charge.git_commits.length > 0) {
      summary += `Git commits: ${charge.git_commits.map((c) => c.slice(0, 7)).join(", ")}
`;
    }
    return summary;
  }
  /**
   * Show charge creation help
   */
  showChargeHelp() {
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
  async createChargeWizard() {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });
    try {
      const summary = await this.askQuestion(rl, "Summary of work completed: ");
      if (!summary.trim()) {
        throw new Error("Summary is required");
      }
      const unitsStr = await this.askQuestion(rl, "Units (hours, points, etc.): ");
      const units = parseFloat(unitsStr);
      if (Number.isNaN(units) || units <= 0) {
        throw new Error("Units must be a positive number");
      }
      const includeCommits = await this.askQuestion(rl, "Include recent git commits? (y/n): ");
      let gitCommits = [];
      if (includeCommits.toLowerCase().startsWith("y")) {
        const recentCommits = await this.git.getRecentCommits(5);
        if (recentCommits.length > 0) {
          console.log("\nRecent commits:");
          recentCommits.forEach((commit, index) => {
            console.log(`${index + 1}. ${commit.hash.slice(0, 7)} - ${commit.subject}`);
          });
          const selection = await this.askQuestion(
            rl,
            'Select commits (comma-separated numbers, or "all"): '
          );
          if (selection.toLowerCase() === "all") {
            gitCommits = recentCommits.map((c) => c.hash);
          } else {
            const indices = selection.split(",").map((s) => parseInt(s.trim(), 10) - 1);
            gitCommits = indices.filter((i) => i >= 0 && i < recentCommits.length).map((i) => recentCommits[i].hash);
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
  askQuestion(rl, question) {
    return new Promise((resolve2) => {
      rl.question(question, (answer) => {
        resolve2(answer);
      });
    });
  }
};

// src/lib/collect.ts
var Collector = class {
  storage;
  config;
  constructor(storage, config) {
    this.storage = storage;
    this.config = config;
  }
  /**
   * Collect charges with optional filtering
   */
  async collect(filterString) {
    const filters = this.parseFilters(filterString || "");
    const allCharges = await this.storage.findCharges();
    let filteredCharges = allCharges;
    if (filters.state) {
      filteredCharges = filteredCharges.filter(
        (charge) => this.matchesStateFilter(charge, filters.state)
      );
    }
    if (filters.context) {
      filteredCharges = filteredCharges.filter(
        (charge) => this.matchesContextFilter(charge, filters.context)
      );
    }
    if (filters.units) {
      filteredCharges = filteredCharges.filter(
        (charge) => this.matchesUnitsFilter(charge, filters.units)
      );
    }
    if (filters.since) {
      const sinceDate = this.parseTimeFilter(filters.since);
      filteredCharges = filteredCharges.filter((charge) => new Date(charge.timestamp) >= sinceDate);
    }
    if (filters.before) {
      const beforeDate = this.parseTimeFilter(filters.before);
      filteredCharges = filteredCharges.filter((charge) => new Date(charge.timestamp) <= beforeDate);
    }
    if (filters.summary) {
      const searchTerm = filters.summary.toLowerCase();
      filteredCharges = filteredCharges.filter(
        (charge) => charge.summary.toLowerCase().includes(searchTerm)
      );
    }
    if (!filterString || filterString.trim() === "") {
      filteredCharges = filteredCharges.filter((charge) => charge.state === "unmarked");
    }
    filteredCharges.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    const aggregates = await this.calculateAggregates(filteredCharges);
    return {
      charges: filteredCharges,
      aggregates
    };
  }
  /**
   * Parse filter string into criteria
   * Format: "mark:unmarked workspace:@acme-* units:\">2\" since:7d"
   */
  parseFilters(filterString) {
    const filters = {};
    if (!filterString.trim()) {
      return filters;
    }
    const parts = this.splitFilterString(filterString);
    for (const part of parts) {
      const [key, value] = part.split(":", 2);
      if (!key || !value) continue;
      const cleanValue = value.replace(/^["']|["']$/g, "");
      switch (key.toLowerCase()) {
        case "mark":
        case "state":
          filters.state = cleanValue;
          break;
        case "workspace":
          filters.context = cleanValue;
          break;
        case "units":
          filters.units = cleanValue;
          break;
        case "since":
          filters.since = cleanValue;
          break;
        case "before":
          filters.before = cleanValue;
          break;
        case "summary":
        case "message":
          filters.summary = cleanValue;
          break;
      }
    }
    return filters;
  }
  /**
   * Split filter string respecting quoted values
   */
  splitFilterString(filterString) {
    const parts = [];
    let current = "";
    let inQuotes = false;
    let quoteChar = "";
    for (let i = 0; i < filterString.length; i++) {
      const char = filterString[i];
      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
        current += char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        current += char;
      } else if (char === " " && !inQuotes) {
        if (current.trim()) {
          parts.push(current.trim());
          current = "";
        }
      } else {
        current += char;
      }
    }
    if (current.trim()) {
      parts.push(current.trim());
    }
    return parts;
  }
  /**
   * Check if charge matches state filter
   */
  matchesStateFilter(charge, stateFilter) {
    return charge.state === stateFilter;
  }
  /**
   * Check if charge matches context filter (supports wildcards)
   */
  matchesContextFilter(charge, contextFilter) {
    if (contextFilter.includes("*")) {
      const pattern = contextFilter.replace(/\*/g, ".*").replace(/\?/g, ".");
      const regex = new RegExp(`^${pattern}$`);
      return regex.test(charge.context);
    }
    return charge.context === contextFilter;
  }
  /**
   * Check if charge matches units filter
   * Supports: ">2", ">=3", "<5", "<=4", "2.5", "2-5"
   */
  matchesUnitsFilter(charge, unitsFilter) {
    const units = charge.units;
    if (unitsFilter.includes("-")) {
      const [min, max] = unitsFilter.split("-").map((s) => parseFloat(s.trim()));
      if (!Number.isNaN(min) && !Number.isNaN(max)) {
        return units >= min && units <= max;
      }
    }
    if (unitsFilter.startsWith(">=")) {
      const value = parseFloat(unitsFilter.slice(2));
      return !Number.isNaN(value) && units >= value;
    }
    if (unitsFilter.startsWith("<=")) {
      const value = parseFloat(unitsFilter.slice(2));
      return !Number.isNaN(value) && units <= value;
    }
    if (unitsFilter.startsWith(">")) {
      const value = parseFloat(unitsFilter.slice(1));
      return !Number.isNaN(value) && units > value;
    }
    if (unitsFilter.startsWith("<")) {
      const value = parseFloat(unitsFilter.slice(1));
      return !Number.isNaN(value) && units < value;
    }
    const exactValue = parseFloat(unitsFilter);
    return !Number.isNaN(exactValue) && units === exactValue;
  }
  /**
   * Parse time filter into Date
   * Supports: "7d", "2w", "1m", "2025-09-01", "2025-09-01T10:00:00Z"
   */
  parseTimeFilter(timeFilter) {
    const now = /* @__PURE__ */ new Date();
    if (timeFilter.endsWith("d")) {
      const days = parseInt(timeFilter.slice(0, -1), 10);
      return new Date(now.getTime() - days * 24 * 60 * 60 * 1e3);
    }
    if (timeFilter.endsWith("w")) {
      const weeks = parseInt(timeFilter.slice(0, -1), 10);
      return new Date(now.getTime() - weeks * 7 * 24 * 60 * 60 * 1e3);
    }
    if (timeFilter.endsWith("m")) {
      const months = parseInt(timeFilter.slice(0, -1), 10);
      const result = new Date(now);
      result.setMonth(result.getMonth() - months);
      return result;
    }
    if (timeFilter.endsWith("y")) {
      const years = parseInt(timeFilter.slice(0, -1), 10);
      const result = new Date(now);
      result.setFullYear(result.getFullYear() - years);
      return result;
    }
    const parsed = new Date(timeFilter);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
    throw new Error(`Invalid time filter: ${timeFilter}`);
  }
  /**
   * Calculate aggregates for a collection of charges
   */
  async calculateAggregates(charges) {
    const count = charges.length;
    const total_units = charges.reduce((sum, charge) => sum + charge.units, 0);
    const workspaces = new Set(charges.map((charge) => charge.context)).size;
    const avg_units = count > 0 ? total_units / count : 0;
    let total_amount = 0;
    const contextRates = /* @__PURE__ */ new Map();
    for (const charge of charges) {
      if (!contextRates.has(charge.context)) {
        const rate2 = await this.config.getRate(charge.context);
        contextRates.set(charge.context, rate2 || 0);
      }
      const rate = contextRates.get(charge.context) || 0;
      total_amount += charge.units * rate;
    }
    return {
      count,
      total_units,
      total_amount,
      avg_units,
      workspaces
    };
  }
  /**
   * Format charges for display
   */
  formatCharges(charges, format = "table") {
    if (format === "json") {
      return JSON.stringify(charges, null, 2);
    }
    if (format === "csv") {
      const headers = ["id", "context", "summary", "units", "state", "timestamp"];
      const rows = charges.map((charge) => [
        charge.id,
        charge.context,
        `"${charge.summary.replace(/"/g, '""')}"`,
        // Escape quotes in CSV
        charge.units.toString(),
        charge.state,
        charge.timestamp
      ]);
      return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
    }
    if (charges.length === 0) {
      return "No charges found.";
    }
    const lines = [];
    for (const charge of charges) {
      const id = charge.id.slice(0, 7);
      const summary = charge.summary.padEnd(30).slice(0, 30);
      const units = charge.units.toString().padStart(6);
      const context = charge.context.padEnd(20).slice(0, 20);
      lines.push(`${id}  ${context}  ${summary}  ${units} units  [${charge.state}]`);
    }
    return lines.join("\n");
  }
  /**
   * Format aggregates for display
   */
  formatAggregates(aggregates) {
    return `Total: ${aggregates.count} charges, ${aggregates.total_units} units, $${aggregates.total_amount.toFixed(2)}`;
  }
  /**
   * Get collection with formatted output
   */
  async getFormattedCollection(filterString, format = "table") {
    const result = await this.collect(filterString);
    if (format === "json") {
      return JSON.stringify(result, null, 2);
    }
    const chargesOutput = this.formatCharges(result.charges, format);
    if (format === "csv") {
      return chargesOutput;
    }
    const aggregatesOutput = this.formatAggregates(result.aggregates);
    return result.charges.length > 0 ? `${chargesOutput}

${aggregatesOutput}` : "No charges found.";
  }
  /**
   * Show collection help
   */
  showCollectHelp() {
    console.log(`
Collection and Filtering Help:

Basic usage:
  gig collect                      # Unmarked charges only (default)
  gig collect mark:collectible     # Filter by state
  gig collect workspace:@acme-*    # Workspace with wildcards
  gig collect units:">2"           # Units greater than 2

Filter syntax:
  mark:<state>        - Filter by charge state (unmarked, collectible, billed, paid)
  workspace:<pattern> - Filter by workspace (supports * wildcards)
  units:<filter>    - Units filter (>, >=, <, <=, exact, range like "2-5")
  since:<time>      - Charges since time (7d, 2w, 1m, 2025-09-01)
  before:<time>     - Charges before time
  summary:<text>    - Search in summary text

Combine filters:
  gig collect mark:unmarked workspace:@acme-* units:">1"
  gig collect since:7d units:"2-5"

Output formats:
  gig collect --json    # JSON format
  gig collect --csv     # CSV format

Examples:
  gig collect mark:collectible
  gig collect workspace:client/project since:30d
  gig collect units:">2" mark:unmarked
`);
  }
};

// src/lib/config.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join as join2 } from "node:path";
var ConfigError = class extends Error {
  constructor(message, cause) {
    super(message);
    this.cause = cause;
    this.name = "ConfigError";
  }
};
var Config = class {
  gigDir;
  globalConfigPath;
  contextManager;
  constructor(contextManager) {
    this.contextManager = contextManager;
    this.gigDir = process.env.GIG_CONFIG_PATH || join2(homedir(), ".gig");
    this.globalConfigPath = join2(this.gigDir, "config.json");
  }
  /**
   * Ensure gig directory exists (async version)
   */
  async ensureGigDirectory() {
    try {
      await mkdir(this.gigDir, { recursive: true });
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw new ConfigError(`Failed to create config directory: ${error}`);
      }
    }
  }
  /**
   * Get the config file path for a context
   */
  getContextConfigPath(context) {
    const contextDir = join2(this.gigDir, "contexts", context.replace("/", "_"));
    return join2(contextDir, "config.json");
  }
  /**
   * Load configuration from a file (async version)
   */
  async loadConfig(filePath) {
    try {
      const content = await readFile(filePath, "utf8");
      return JSON.parse(content);
    } catch (error) {
      if (error.code === "ENOENT") {
        return {};
      }
      throw new ConfigError(`Failed to parse config file ${filePath}: ${error}`);
    }
  }
  /**
   * Save configuration to a file
   */
  async saveConfig(filePath, config) {
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });
    const content = JSON.stringify(config, null, 2);
    await writeFile(filePath, content);
  }
  /**
   * Load global configuration
   */
  async loadGlobalConfig() {
    return await this.loadConfig(this.globalConfigPath);
  }
  /**
   * Save global configuration
   */
  async saveGlobalConfig(config) {
    await this.saveConfig(this.globalConfigPath, config);
  }
  /**
   * Load context-specific configuration
   */
  async loadContextConfig(context) {
    const contextConfigPath = this.getContextConfigPath(context);
    return await this.loadConfig(contextConfigPath);
  }
  /**
   * Save context-specific configuration
   */
  async saveContextConfig(context, config) {
    const contextConfigPath = this.getContextConfigPath(context);
    await this.saveConfig(contextConfigPath, config);
  }
  /**
   * Set a configuration value with validation
   */
  async set(key, value, global = false) {
    if (!key?.trim()) {
      throw new ConfigError("Configuration key cannot be empty");
    }
    const parsedValue = this.parseValue(value);
    await this.ensureGigDirectory();
    if (global) {
      await this.setGlobalValue(key, parsedValue);
    } else {
      const currentContext = await this.contextManager.getCurrentWorkspace();
      await this.setContextValue(currentContext, key, parsedValue);
    }
  }
  /**
   * Get a configuration value with hierarchy: context -> global -> default
   */
  async get(key, context) {
    const targetContext = context || await this.contextManager.getCurrentWorkspace();
    const contextValue = await this.getContextValue(targetContext, key);
    if (contextValue !== void 0) {
      return contextValue;
    }
    const globalValue = await this.getGlobalValue(key);
    if (globalValue !== void 0) {
      return globalValue;
    }
    return void 0;
  }
  /**
   * Set a global configuration value
   */
  async setGlobalValue(key, value) {
    const config = await this.loadGlobalConfig();
    this.setNestedValue(config, key, value);
    await this.saveGlobalConfig(config);
  }
  /**
   * Get a global configuration value
   */
  async getGlobalValue(key) {
    const config = await this.loadGlobalConfig();
    return this.getNestedValue(config, key);
  }
  /**
   * Set a context-specific configuration value
   */
  async setContextValue(context, key, value) {
    const config = await this.loadContextConfig(context);
    this.setNestedValue(config, key, value);
    await this.saveContextConfig(context, config);
  }
  /**
   * Get a context-specific configuration value
   */
  async getContextValue(context, key) {
    const config = await this.loadContextConfig(context);
    return this.getNestedValue(config, key);
  }
  /**
   * Set a nested value in a config object using dot notation
   */
  setNestedValue(config, key, value) {
    const parts = key.split(".");
    let current = config;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current) || typeof current[part] !== "object" || Array.isArray(current[part])) {
        current[part] = {};
      }
      current = current[part];
    }
    current[parts[parts.length - 1]] = value;
  }
  /**
   * Get a nested value from a config object using dot notation
   */
  getNestedValue(config, key) {
    const parts = key.split(".");
    let current = config;
    for (const part of parts) {
      if (current === null || current === void 0 || typeof current !== "object" || Array.isArray(current)) {
        return void 0;
      }
      current = current[part];
    }
    return typeof current === "string" || typeof current === "number" || typeof current === "boolean" ? current : void 0;
  }
  /**
   * Parse a value to appropriate type with better validation
   */
  parseValue(value) {
    if (typeof value !== "string") {
      return value;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return trimmed;
    }
    if (/^-?\d*\.?\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      if (Number.isFinite(num)) {
        return num;
      }
    }
    const lower = trimmed.toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
    return trimmed;
  }
  /**
   * List all configuration keys and values for current context
   */
  async list(context) {
    const targetContext = context || await this.contextManager.getCurrentWorkspace();
    const result = {};
    const globalConfig = await this.loadGlobalConfig();
    this.flattenConfig(globalConfig, result, "global");
    const contextConfig = await this.loadContextConfig(targetContext);
    this.flattenConfig(contextConfig, result, `context.${targetContext}`);
    return result;
  }
  /**
   * Flatten a nested config object for display
   */
  flattenConfig(config, result, prefix) {
    for (const [key, value] of Object.entries(config)) {
      const fullKey = `${prefix}.${key}`;
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        this.flattenConfig(value, result, fullKey);
      } else if (Array.isArray(value)) {
        result[fullKey] = value.join(", ");
      } else {
        result[fullKey] = value;
      }
    }
  }
  /**
   * Get repositories for the current context
   */
  async getRepositories(context) {
    const repos = await this.get("repositories", context);
    if (Array.isArray(repos)) {
      return repos;
    }
    if (typeof repos === "string") {
      return repos.split(/\s+/).filter((path) => path.length > 0);
    }
    return [];
  }
  /**
   * Set repositories for the current context
   */
  async setRepositories(repositories, global = false) {
    await this.set("repositories", repositories.join(" "), global);
  }
  /**
   * Add a repository to the current context
   */
  async addRepository(repoPath, global = false) {
    const currentRepos = await this.getRepositories();
    if (!currentRepos.includes(repoPath)) {
      currentRepos.push(repoPath);
      await this.setRepositories(currentRepos, global);
    }
  }
  /**
   * Remove a repository from the current context
   */
  async removeRepository(repoPath, global = false) {
    const currentRepos = await this.getRepositories();
    const filtered = currentRepos.filter((repo) => repo !== repoPath);
    await this.setRepositories(filtered, global);
  }
  /**
   * Get the hourly rate for the current context
   */
  async getRate(context) {
    const rate = await this.get("rate", context);
    return typeof rate === "number" ? rate : void 0;
  }
  /**
   * Get the client name for the current context
   */
  async getClient(context) {
    const client = await this.get("client", context);
    return typeof client === "string" ? client : void 0;
  }
};

// src/lib/context.ts
var WorkspaceError = class extends Error {
  constructor(message, operation, workspace) {
    super(message);
    this.operation = operation;
    this.workspace = workspace;
    this.name = "WorkspaceError";
  }
};
var WorkspaceValidationError = class extends WorkspaceError {
  constructor(workspace, reason) {
    super(`Invalid workspace name '${workspace}': ${reason}`, "validation", workspace);
    this.name = "WorkspaceValidationError";
  }
};
var WorkspaceNotFoundError = class extends WorkspaceError {
  constructor(workspace) {
    super(`Workspace '${workspace}' does not exist`, "not-found", workspace);
    this.name = "WorkspaceNotFoundError";
  }
};
var WORKSPACE_PATTERNS = {
  VALID_CHARS: /^[a-zA-Z0-9@_-]+(?:\/[a-zA-Z0-9@_-]+)*$/,
  RESERVED_NAMES: /* @__PURE__ */ new Set(["default", "HEAD", "refs", "objects"]),
  MAX_LENGTH: 200,
  MAX_SEGMENTS: 5
};
var WorkspaceManager = class {
  storage;
  workspaceCache = /* @__PURE__ */ new Map();
  CACHE_TTL_MS = 1e4;
  // 10 seconds
  constructor(storage) {
    this.storage = storage;
  }
  /**
   * Get the current workspace
   */
  async getCurrentWorkspace() {
    return await this.storage.getCurrentContext();
  }
  /**
   * Switch to a different workspace
   */
  async switchWorkspace(context) {
    this.validateWorkspaceName(context);
    const exists = await this.workspaceExistsWithCache(context);
    if (!exists) {
      throw new WorkspaceNotFoundError(context);
    }
    await this.storage.setCurrentContext(context);
  }
  /**
   * Create a new workspace and switch to it
   */
  async createWorkspace(context) {
    this.validateWorkspaceName(context);
    const exists = await this.workspaceExistsWithCache(context);
    if (exists) {
      throw new WorkspaceError(`Workspace '${context}' already exists`, "create", context);
    }
    await this.storage.updateRef(context, "");
    this.workspaceCache.delete(context);
    await this.storage.setCurrentContext(context);
  }
  /**
   * List all workspaces
   */
  async listWorkspaces() {
    const contexts = await this.storage.getAllContexts();
    if (!contexts.includes("default")) {
      contexts.unshift("default");
    }
    return contexts.sort();
  }
  /**
   * Check if a workspace exists (synchronous version for backward compatibility)
   * Note: This method may not reflect the most current state due to async storage operations
   */
  workspaceExists(context) {
    if (context === "default") {
      return true;
    }
    const cached = this.workspaceCache.get(context);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.exists;
    }
    try {
      return false;
    } catch {
      return false;
    }
  }
  /**
   * Check if a workspace exists (async version with caching)
   */
  async workspaceExistsAsync(context) {
    return this.workspaceExistsWithCache(context);
  }
  /**
   * Validate workspace name format with comprehensive checks
   */
  validateWorkspaceName(context) {
    if (!context || context.length === 0) {
      throw new WorkspaceValidationError(context, "workspace name cannot be empty");
    }
    if (context.length > WORKSPACE_PATTERNS.MAX_LENGTH) {
      throw new WorkspaceValidationError(
        context,
        `workspace name too long (max ${WORKSPACE_PATTERNS.MAX_LENGTH} characters)`
      );
    }
    const segments = context.split("/");
    if (segments.length > WORKSPACE_PATTERNS.MAX_SEGMENTS) {
      throw new WorkspaceValidationError(
        context,
        `too many path segments (max ${WORKSPACE_PATTERNS.MAX_SEGMENTS})`
      );
    }
    if (WORKSPACE_PATTERNS.RESERVED_NAMES.has(context.toLowerCase())) {
      throw new WorkspaceValidationError(context, "workspace name is reserved");
    }
    if (context.startsWith("/") || context.endsWith("/")) {
      throw new WorkspaceValidationError(context, 'workspace name cannot start or end with "/"');
    }
    if (context.includes("//")) {
      throw new WorkspaceValidationError(context, 'workspace name cannot contain consecutive "/"');
    }
    if (!WORKSPACE_PATTERNS.VALID_CHARS.test(context)) {
      throw new WorkspaceValidationError(
        context,
        "workspace name contains invalid characters (use only a-z, A-Z, 0-9, @, _, -, /)"
      );
    }
    for (const segment of segments) {
      if (segment.length === 0) {
        throw new WorkspaceValidationError(context, "workspace segments cannot be empty");
      }
      if (segment.startsWith("-") || segment.endsWith("-")) {
        throw new WorkspaceValidationError(
          context,
          'workspace segments cannot start or end with "-"'
        );
      }
    }
  }
  /**
   * Check if workspace exists with caching
   */
  async workspaceExistsWithCache(context) {
    const now = Date.now();
    const cached = this.workspaceCache.get(context);
    if (cached && now - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.exists;
    }
    const exists = context === "default" || await this.storage.contextExists(context);
    this.workspaceCache.set(context, { exists, timestamp: now });
    return exists;
  }
  /**
   * Get workspace information including charge count
   */
  async getWorkspaceInfo(context) {
    const targetContext = context || await this.getCurrentWorkspace();
    const currentContext = await this.getCurrentWorkspace();
    const charges = await this.storage.getAllCharges(targetContext);
    const lastCharge = charges.length > 0 ? charges[0] : void 0;
    return {
      name: targetContext,
      current: targetContext === currentContext,
      chargeCount: charges.length,
      lastCharge: lastCharge?.summary,
      lastModified: lastCharge ? new Date(lastCharge.timestamp) : void 0
    };
  }
  /**
   * Get all workspaces with their information (parallel execution for performance)
   */
  async getAllWorkspacesInfo() {
    const contexts = await this.listWorkspaces();
    const infoPromises = contexts.map(
      (context) => this.getWorkspaceInfo(context).catch((error) => {
        console.error(`Failed to get info for workspace ${context}:`, error);
        return {
          name: context,
          current: false,
          chargeCount: 0,
          lastCharge: void 0,
          lastModified: void 0
        };
      })
    );
    return Promise.all(infoPromises);
  }
  /**
   * Delete a workspace (removes all references but keeps charges in objects)
   */
  async deleteWorkspace(context) {
    if (context === "default") {
      throw new Error("Cannot delete the default workspace");
    }
    if (!this.storage.contextExists(context)) {
      throw new Error(`Workspace '${context}' does not exist`);
    }
    const currentContext = await this.getCurrentWorkspace();
    if (currentContext === context) {
      throw new Error("Cannot delete the current workspace. Switch to another workspace first.");
    }
    throw new Error(
      "Workspace deletion not yet implemented. Manually remove the ref file if needed."
    );
  }
  /**
   * Parse workspace patterns for filtering with enhanced security
   * Supports wildcards like @acme-* or client/*
   */
  parseWorkspacePattern(pattern) {
    if (pattern.length > 100) {
      throw new WorkspaceValidationError(pattern, "pattern too long (max 100 characters)");
    }
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const regexPattern = escaped.replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
    try {
      return new RegExp(`^${regexPattern}$`);
    } catch (error) {
      throw new WorkspaceValidationError(pattern, `invalid regex pattern: ${error}`);
    }
  }
  /**
   * Find workspaces matching a pattern
   */
  async findWorkspacesMatching(pattern) {
    const allContexts = await this.listWorkspaces();
    const regex = this.parseWorkspacePattern(pattern);
    return allContexts.filter((context) => regex.test(context));
  }
};

// src/lib/git.ts
import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { join as join3, resolve } from "node:path";
import { promisify } from "node:util";
var execAsync = promisify(exec);
var repoValidationCache = /* @__PURE__ */ new Map();
var CACHE_TTL_MS = 3e4;
var GitIntegration = class {
  config;
  constructor(config) {
    this.config = config;
  }
  /**
   * Check if a directory is a git repository with caching
   */
  isGitRepository(path) {
    const now = Date.now();
    const cached = repoValidationCache.get(path);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return cached.isValid;
    }
    const gitDir = join3(path, ".git");
    const isValid = existsSync(gitDir);
    repoValidationCache.set(path, { isValid, timestamp: now });
    return isValid;
  }
  /**
   * Execute git command with proper error handling and timeout
   */
  async executeGitCommand(command, repoPath, timeout = 5e3) {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: repoPath,
        encoding: "utf8",
        timeout,
        maxBuffer: 1024 * 1024
        // 1MB buffer limit
      });
      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        success: true
      };
    } catch (error) {
      const err = error;
      return {
        stdout: err.stdout || "",
        stderr: err.stderr || err.message,
        success: false,
        error: err
      };
    }
  }
  /**
   * Validate and parse git commit line with type safety
   */
  parseCommitLine(line, repository) {
    if (!line.trim()) return null;
    const parts = line.split("|");
    if (parts.length !== 4) {
      console.warn(`Invalid git log format in ${repository}: expected 4 parts, got ${parts.length}`);
      return null;
    }
    const [hash, subject, author, date] = parts;
    if (!hash?.trim() || !subject?.trim()) {
      console.warn(`Invalid commit data in ${repository}: missing hash or subject`);
      return null;
    }
    if (!this.isValidCommitHash(hash.trim())) {
      console.warn(`Invalid commit hash format in ${repository}: ${hash}`);
      return null;
    }
    return {
      hash: hash.trim(),
      subject: subject.trim(),
      author: author?.trim() || "Unknown",
      date: date?.trim() || "",
      repository
    };
  }
  /**
   * Get recent commits from a git repository (async with proper error handling)
   */
  async getCommitsFromRepo(repoPath, count = 10) {
    const resolvedPath = resolve(repoPath);
    if (!this.isGitRepository(resolvedPath)) {
      return [];
    }
    const gitCommand = `git log --oneline --format="%H|%s|%an|%ad" --date=iso --no-merges -n ${count}`;
    const result = await this.executeGitCommand(gitCommand, resolvedPath);
    if (!result.success) {
      console.error(`Failed to get commits from ${repoPath}: ${result.stderr}`);
      return [];
    }
    const commits = [];
    const lines = result.stdout.split("\n");
    for (const line of lines) {
      const commit = this.parseCommitLine(line, repoPath);
      if (commit) {
        commits.push(commit);
      }
    }
    return commits;
  }
  /**
   * Get recent commits from all configured repositories (parallel execution)
   */
  async getRecentCommits(count = 10) {
    const repositories = await this.config.getRepositories();
    if (repositories.length === 0) {
      const currentDir = process.cwd();
      if (this.isGitRepository(currentDir)) {
        return this.getCommitsFromRepo(currentDir, count);
      }
      return [];
    }
    const commitPromises = repositories.map(
      (repo) => this.getCommitsFromRepo(repo, count).catch((error) => {
        console.error(`Failed to get commits from ${repo}:`, error);
        return [];
      })
    );
    const allCommitsArrays = await Promise.all(commitPromises);
    const allCommits = allCommitsArrays.flat();
    return allCommits.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return dateB - dateA;
    }).slice(0, count);
  }
  /**
   * Get commits from a specific repository
   */
  async getCommitsFromRepository(repoPath, count = 10) {
    return this.getCommitsFromRepo(repoPath, count);
  }
  /**
   * Check if a commit exists in any configured repository (parallel search)
   */
  async commitExists(commitHash) {
    if (!this.isValidCommitHash(commitHash)) {
      return { exists: false };
    }
    const repositories = await this.config.getRepositories();
    const reposToCheck = repositories.length > 0 ? repositories : [process.cwd()];
    const checkPromises = reposToCheck.map(async (repo) => {
      const resolvedPath = resolve(repo);
      if (!this.isGitRepository(resolvedPath)) {
        return null;
      }
      const result = await this.executeGitCommand(
        `git cat-file -e ${commitHash}`,
        resolvedPath,
        2e3
        // 2 second timeout for existence check
      );
      return result.success ? repo : null;
    });
    const results = await Promise.all(checkPromises);
    const foundRepo = results.find((repo) => repo !== null);
    return foundRepo ? { exists: true, repository: foundRepo } : { exists: false };
  }
  /**
   * Get commit details by hash
   */
  async getCommitDetails(commitHash) {
    const { exists, repository } = await this.commitExists(commitHash);
    if (!exists || !repository) {
      return null;
    }
    const resolvedPath = resolve(repository);
    const result = await this.executeGitCommand(
      `git show --no-patch --format="%H|%s|%an|%ad" --date=iso ${commitHash}`,
      resolvedPath
    );
    if (!result.success) {
      console.error(`Failed to get commit details for ${commitHash}:`, result.stderr);
      return null;
    }
    return this.parseCommitLine(result.stdout, repository);
  }
  /**
   * Generate a template with recent commits for charge creation
   */
  async generateChargeTemplate() {
    const commits = await this.getRecentCommits(10);
    const repositories = await this.config.getRepositories();
    let template = `summary: |
  
units: 
`;
    if (commits.length > 0) {
      template += `git:
`;
      if (repositories.length > 1) {
        const commitsByRepo = commits.reduce(
          (acc, commit) => {
            const repoName = this.getRepoName(commit.repository);
            if (!acc[repoName]) {
              acc[repoName] = [];
            }
            acc[repoName].push(commit);
            return acc;
          },
          {}
        );
        for (const [repoName, repoCommits] of Object.entries(commitsByRepo)) {
          template += `  ${repoName}:
`;
          for (const commit of repoCommits.slice(0, 5)) {
            template += `    ${commit.hash.slice(0, 7)}: "${commit.subject}"
`;
          }
        }
      } else {
        for (const commit of commits.slice(0, 10)) {
          template += `  ${commit.hash.slice(0, 7)}: "${commit.subject}"
`;
        }
      }
    }
    template += `timestamp: "${(/* @__PURE__ */ new Date()).toISOString()}"
`;
    return template;
  }
  /**
   * Extract a simple repository name from a path
   */
  getRepoName(repoPath) {
    const normalized = repoPath.replace(/\/$/, "");
    const parts = normalized.split("/");
    return parts[parts.length - 1] || "repo";
  }
  /**
   * Validate and extract commit hashes from charge git data
   */
  async validateCommits(gitData) {
    if (!gitData || typeof gitData !== "object") {
      return [];
    }
    const commits = [];
    if (typeof gitData === "object") {
      for (const [key, value] of Object.entries(gitData)) {
        if (typeof value === "object" && value !== null) {
          for (const [commitHash] of Object.entries(value)) {
            if (this.isValidCommitHash(commitHash)) {
              commits.push(commitHash);
            }
          }
        } else if (this.isValidCommitHash(key)) {
          commits.push(key);
        }
      }
    }
    const validCommits = [];
    for (const commit of commits) {
      const { exists } = await this.commitExists(commit);
      if (exists) {
        validCommits.push(commit);
      }
    }
    return validCommits;
  }
  /**
   * Check if a string looks like a valid git commit hash
   */
  isValidCommitHash(hash) {
    return /^[a-f0-9]{7,40}$/i.test(hash);
  }
  /**
   * Add current directory as a repository if it's a git repo
   */
  async addCurrentDirectoryIfGitRepo() {
    const currentDir = process.cwd();
    if (this.isGitRepository(currentDir)) {
      await this.config.addRepository(currentDir);
      return true;
    }
    return false;
  }
  /**
   * List all configured repositories with their status (optimized with parallel checks)
   */
  async listRepositories() {
    const repositories = await this.config.getRepositories();
    const repoPromises = repositories.map(async (repo) => {
      const resolvedPath = resolve(repo);
      const exists = existsSync(resolvedPath);
      const isGitRepo = exists ? this.isGitRepository(resolvedPath) : false;
      let commitCount;
      let lastCommitDate;
      if (isGitRepo) {
        try {
          const countResult = await this.executeGitCommand(
            "git rev-list --count HEAD",
            resolvedPath,
            3e3
          );
          if (countResult.success) {
            commitCount = parseInt(countResult.stdout.trim(), 10) || 0;
          }
          const dateResult = await this.executeGitCommand(
            'git log -1 --format="%ad" --date=iso',
            resolvedPath,
            2e3
          );
          if (dateResult.success) {
            lastCommitDate = dateResult.stdout.trim();
          }
        } catch (error) {
          console.warn(`Failed to get repository stats for ${repo}:`, error);
          commitCount = 0;
        }
      }
      return {
        path: repo,
        exists,
        isGitRepo,
        commitCount,
        lastCommitDate
      };
    });
    return Promise.all(repoPromises);
  }
};

// src/lib/storage.ts
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir as mkdir2, readFile as readFile2, rename, writeFile as writeFile2 } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { dirname as dirname2, join as join4 } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
var StorageError = class extends Error {
  constructor(message, cause) {
    super(message);
    this.cause = cause;
    this.name = "StorageError";
  }
};
var ChargeNotFoundError = class extends StorageError {
  constructor(chargeId) {
    super(`Charge ${chargeId} not found`);
    this.name = "ChargeNotFoundError";
  }
};
var CHARGE_STATES = ["unmarked", "collectible", "billed", "paid"];
var Storage = class {
  gigDir;
  objectsDir;
  refsDir;
  constructor() {
    this.gigDir = process.env.GIG_CONFIG_PATH || join4(homedir2(), ".gig");
    this.objectsDir = join4(this.gigDir, "objects");
    this.refsDir = join4(this.gigDir, "refs");
  }
  /**
   * Lazy initialization of directories using async I/O
   * Called only when needed to avoid blocking constructor
   */
  async ensureDirectories() {
    try {
      await mkdir2(this.gigDir, { recursive: true });
      await mkdir2(this.objectsDir, { recursive: true });
      await mkdir2(this.refsDir, { recursive: true });
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw new StorageError(`Failed to create storage directories: ${error}`);
      }
    }
  }
  /**
   * Generate SHA-256 hash for content addressing
   */
  generateHash(content) {
    return createHash("sha256").update(content, "utf8").digest("hex");
  }
  /**
   * Validate charge input before storing
   */
  validateChargeInput(charge) {
    if (!charge.summary?.trim()) {
      throw new StorageError("Charge summary is required");
    }
    if (typeof charge.units !== "number" || charge.units <= 0) {
      throw new StorageError("Charge units must be a positive number");
    }
    if (!CHARGE_STATES.includes(charge.state)) {
      throw new StorageError(`Invalid charge state: ${charge.state}`);
    }
    if (!charge.context?.trim()) {
      throw new StorageError("Charge context is required");
    }
    if (!charge.timestamp || Number.isNaN(Date.parse(charge.timestamp))) {
      throw new StorageError("Invalid timestamp format, expected ISO 8601");
    }
  }
  /**
   * Safely unlink a file, suppressing ENOENT errors
   */
  async safeUnlink(filePath) {
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`Warning: Failed to cleanup temp file ${filePath}:`, error);
      }
    }
  }
  /**
   * Get the file path for an object by its hash
   */
  getObjectPath(hash) {
    const dir = hash.slice(0, 2);
    const file = hash.slice(2);
    return join4(this.objectsDir, dir, file);
  }
  /**
   * Store a charge object with content addressing and validation
   */
  async storeCharge(charge) {
    this.validateChargeInput(charge);
    await this.ensureDirectories();
    const content = JSON.stringify(charge, null, 2);
    const hash = this.generateHash(content);
    const objectPath = this.getObjectPath(hash);
    try {
      await readFile2(objectPath);
      return hash;
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw new StorageError(`Error checking existing object: ${error}`);
      }
    }
    await mkdir2(dirname2(objectPath), { recursive: true });
    const { randomUUID } = await import("node:crypto");
    const tempPath = `${objectPath}.tmp.${randomUUID()}`;
    try {
      const gzip = createGzip({ level: 6, chunkSize: 1024 });
      const writeStream = createWriteStream(tempPath);
      await pipeline([content], gzip, writeStream);
      await rename(tempPath, objectPath);
      return hash;
    } catch (error) {
      await this.safeUnlink(tempPath);
      throw new StorageError(`Failed to store charge: ${error}`, error);
    }
  }
  /**
   * Retrieve a charge object by its hash with error handling
   */
  async getCharge(hash) {
    const objectPath = this.getObjectPath(hash);
    try {
      const readStream = createReadStream(objectPath);
      const gunzip = createGunzip();
      const chunks = [];
      await pipeline(readStream, gunzip, async (source) => {
        for await (const chunk of source) {
          chunks.push(chunk);
        }
      });
      const content = Buffer.concat(chunks).toString("utf8");
      const chargeData = JSON.parse(content);
      this.validateChargeInput(chargeData);
      return {
        id: hash,
        ...chargeData
      };
    } catch (error) {
      if (error.code === "ENOENT") {
        return null;
      }
      throw new ChargeNotFoundError(hash);
    }
  }
  /**
   * Update a reference (HEAD pointer for context) with atomic write
   */
  async updateRef(context, hash) {
    await this.ensureDirectories();
    const refPath = join4(this.refsDir, `${context.replace("/", "_")}`);
    const { randomUUID } = await import("node:crypto");
    const tempPath = `${refPath}.tmp.${randomUUID()}`;
    try {
      await writeFile2(tempPath, hash, "utf8");
      await rename(tempPath, refPath);
    } catch (error) {
      await this.safeUnlink(tempPath);
      throw new StorageError(`Failed to update ref for context ${context}: ${error}`, error);
    }
  }
  /**
   * Get the HEAD reference for a context
   */
  async getRef(context) {
    const refPath = join4(this.refsDir, `${context.replace("/", "_")}`);
    try {
      const content = await readFile2(refPath, "utf8");
      return content.trim() || null;
    } catch (error) {
      if (error.code === "ENOENT") {
        return null;
      }
      throw new StorageError(`Failed to read ref for context ${context}: ${error}`, error);
    }
  }
  /**
   * Get the current context (async version to avoid blocking I/O)
   */
  async getCurrentContext() {
    const currentContextPath = join4(this.gigDir, "current-context");
    try {
      const content = await readFile2(currentContextPath, "utf8");
      return content.trim() || "default";
    } catch (error) {
      if (error.code === "ENOENT") {
        return "default";
      }
      throw new StorageError(`Failed to read current context: ${error}`);
    }
  }
  /**
   * Set the current context
   */
  async setCurrentContext(context) {
    const currentContextPath = join4(this.gigDir, "current-context");
    await writeFile2(currentContextPath, context);
  }
  /**
   * Check if a context exists (async version)
   */
  async contextExists(context) {
    const refPath = join4(this.refsDir, `${context.replace("/", "_")}`);
    try {
      await readFile2(refPath, "utf8");
      return true;
    } catch (error) {
      return error.code !== "ENOENT";
    }
  }
  /**
   * Get all contexts
   */
  async getAllContexts() {
    try {
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(this.refsDir);
      return files.map((file) => file.replace("_", "/"));
    } catch {
      return [];
    }
  }
  /**
   * Walk the charge history from HEAD backwards
   */
  async *walkHistory(context) {
    let current = await this.getRef(context);
    while (current) {
      const charge = await this.getCharge(current);
      if (!charge) break;
      yield charge;
      current = charge.parent || null;
    }
  }
  /**
   * Get all charges for a context (helper method)
   */
  async getAllCharges(context) {
    const charges = [];
    for await (const charge of this.walkHistory(context)) {
      charges.push(charge);
    }
    return charges;
  }
  /**
   * Find charges across all contexts (for filtering)
   */
  async findCharges(filter) {
    const allCharges = [];
    const contexts = await this.getAllContexts();
    const current = await this.getCurrentContext();
    if (!contexts.includes(current)) {
      contexts.push(current);
    }
    for (const context of contexts) {
      const charges = await this.getAllCharges(context);
      allCharges.push(...charges);
    }
    return filter ? allCharges.filter(filter) : allCharges;
  }
  /**
   * Update a charge's state by creating a new charge object (preserves immutability)
   * This maintains the content-addressed storage principle correctly
   */
  async updateChargeState(chargeId, newState) {
    const originalCharge = await this.getCharge(chargeId);
    if (!originalCharge) {
      throw new ChargeNotFoundError(chargeId);
    }
    const updatedCharge = {
      ...originalCharge,
      state: newState,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      // Update timestamp for the state change
      parent: chargeId
      // Link to the previous version
    };
    return this.storeCharge(updatedCharge);
  }
};

// src/index.ts
function parseArgs() {
  const [, , ...allArgs] = process.argv;
  if (allArgs.length === 0) {
    showHelp();
    process.exit(0);
  }
  const args = [];
  const flags = {};
  let command = "";
  for (let i = 0; i < allArgs.length; i++) {
    const arg = allArgs[i];
    if (arg.startsWith("--")) {
      const [key, value] = arg.slice(2).split("=");
      flags[key] = value || true;
    } else if (arg.startsWith("-")) {
      const key = arg.slice(1);
      const next = allArgs[i + 1];
      if (key === "c" || key === "help" || key === "h" || key === "version" || key === "v" || key === "global" || key === "json" || key === "csv") {
        flags[key] = true;
      } else if (next && !next.startsWith("-")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      if (!command) {
        command = arg;
      } else {
        args.push(arg);
      }
    }
  }
  if (!command && (flags.help || flags.h)) {
    showHelp();
    process.exit(0);
  }
  if (!command && (flags.version || flags.v)) {
    showVersion();
    process.exit(0);
  }
  if (!command) {
    showHelp();
    process.exit(0);
  }
  return {
    command,
    subcommand: args[0],
    args,
    flags
  };
}
function showHelp() {
  console.log(`
gig - Terminal-based business management for developers

USAGE:
  gig <command> [args]

COMMANDS:
  workspace [name]       List workspaces or switch to one (alias: ws)
  workspace -c <name>    Create and switch to new workspace
  config <key> [value]   Get/set configuration
  charge                 Create a new charge (opens editor)
  charge -m <msg> -u <n> Create charge with message and units
  collect [filters]      Query charges with optional filters
  mark <id> <state>      Mark charge with state

EXAMPLES:
  gig workspace -c client/project
  gig charge -m "Built auth system" -u 3
  gig collect workspace:client/*
  gig mark abc123 collectible
`);
}
function showVersion() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname3(__filename);
  const packagePath = join5(__dirname, "package.json");
  try {
    const pkg = JSON.parse(readFileSync2(packagePath, "utf8"));
    console.log(`gig version ${pkg.version}`);
  } catch {
    console.log("gig version unknown");
  }
}
async function main() {
  const { command, subcommand, args, flags } = parseArgs();
  if (flags.help || flags.h) {
    showHelp();
    return;
  }
  if (flags.version || flags.v || command === "version") {
    showVersion();
    return;
  }
  try {
    const storage = new Storage();
    const contextManager = new WorkspaceManager(storage);
    const config = new Config(contextManager);
    const git = new GitIntegration(config);
    const chargeManager = new ChargeManager(storage, config, git);
    const collector = new Collector(storage, config);
    switch (command) {
      case "workspace":
      case "ws":
        await handleWorkspace(contextManager, subcommand, flags);
        break;
      case "config":
        await handleConfig(config, args, flags);
        break;
      case "charge":
        await handleCharge(chargeManager, flags);
        break;
      case "collect":
        await handleCollect(collector, args, flags);
        break;
      case "mark":
        await handleMark(chargeManager, args, flags);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        console.error('Run "gig --help" for usage information.');
        process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
async function handleWorkspace(contextManager, workspace, flags) {
  if (flags.c) {
    if (!workspace) {
      console.error("Error: Workspace name required when creating");
      console.error("Usage: gig workspace -c <name>");
      process.exit(1);
    }
    await contextManager.createWorkspace(workspace);
    console.log(`Created and switched to workspace: ${workspace}`);
    return;
  }
  if (workspace) {
    await contextManager.switchWorkspace(workspace);
    console.log(`Switched to workspace: ${workspace}`);
    return;
  }
  const workspaces = await contextManager.listWorkspaces();
  const current = await contextManager.getCurrentWorkspace();
  for (const ws of workspaces) {
    const marker = ws === current ? "* " : "  ";
    console.log(`${marker}${ws}`);
  }
}
async function handleConfig(config, args, flags) {
  if (args.length === 0) {
    console.error("Error: Config key required");
    console.error("Usage: gig config <key> [value] [--global]");
    process.exit(1);
  }
  const [key, ...valueParts] = args;
  const value = valueParts.join(" ");
  if (value) {
    await config.set(key, value, flags.global);
    console.log(`Set ${key} = ${value}`);
  } else {
    const result = await config.get(key);
    console.log(result || "(not set)");
  }
}
async function handleCharge(chargeManager, flags) {
  if (flags.m && flags.u) {
    await chargeManager.createCharge({
      summary: flags.m,
      units: parseFloat(flags.u)
    });
    console.log("Charge created");
  } else {
    await chargeManager.createChargeInteractive();
  }
}
async function handleCollect(collector, args, flags) {
  const filters = args.join(" ");
  let format = "table";
  if (flags.json) format = "json";
  if (flags.csv) format = "csv";
  const output = await collector.getFormattedCollection(filters, format);
  console.log(output);
}
async function handleMark(chargeManager, args, _flags) {
  if (args.length < 2) {
    console.error("Error: Charge ID and state required");
    console.error("Usage: gig mark <id> <state>");
    process.exit(1);
  }
  const [ids, state] = args;
  const chargeIds = ids.split(",");
  let markedCount = 0;
  for (const id of chargeIds) {
    const partialId = id.trim();
    const matches = await chargeManager.findChargeById(partialId);
    if (matches.length === 0) {
      console.error(`Error: No charge found matching ID ${partialId}`);
      continue;
    }
    if (matches.length > 1) {
      console.error(`Error: Multiple charges match ID ${partialId}:`);
      matches.forEach((charge2) => {
        console.error(`  ${charge2.id.slice(0, 7)} - ${charge2.summary}`);
      });
      continue;
    }
    const charge = matches[0];
    await chargeManager.markCharge(charge.id, state);
    markedCount++;
  }
  if (markedCount > 0) {
    console.log(`Marked ${markedCount} charge(s) as ${state}`);
  }
}
main().catch((error) => {
  console.error(`Fatal error: ${error}`);
  process.exit(1);
});
