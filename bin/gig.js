#!/usr/bin/env node

// src/index.ts
import { readFileSync as readFileSync4 } from "fs";
import { join as join5, dirname as dirname3 } from "path";
import { fileURLToPath } from "url";

// src/lib/storage.ts
import { createHash } from "crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync } from "fs";
import { mkdir, readFile, writeFile, rename } from "fs/promises";
import { dirname, join } from "path";
import { createGzip, createGunzip } from "zlib";
import { pipeline } from "stream/promises";
import { homedir } from "os";
var Storage = class {
  gigDir;
  objectsDir;
  refsDir;
  constructor() {
    this.gigDir = process.env.GIG_CONFIG_PATH || join(homedir(), ".gig");
    this.objectsDir = join(this.gigDir, "objects");
    this.refsDir = join(this.gigDir, "refs");
    this.ensureDirectories();
  }
  ensureDirectories() {
    if (!existsSync(this.gigDir)) {
      mkdirSync(this.gigDir, { recursive: true });
    }
    if (!existsSync(this.objectsDir)) {
      mkdirSync(this.objectsDir, { recursive: true });
    }
    if (!existsSync(this.refsDir)) {
      mkdirSync(this.refsDir, { recursive: true });
    }
  }
  /**
   * Generate SHA-256 hash for content addressing
   */
  generateHash(content) {
    return createHash("sha256").update(content).digest("hex");
  }
  /**
   * Get the file path for an object by its hash
   */
  getObjectPath(hash) {
    const dir = hash.slice(0, 2);
    const file = hash.slice(2);
    return join(this.objectsDir, dir, file);
  }
  /**
   * Store a charge object with content addressing
   */
  async storeCharge(charge) {
    const content = JSON.stringify(charge, null, 2);
    const hash = this.generateHash(content);
    const objectPath = this.getObjectPath(hash);
    await mkdir(dirname(objectPath), { recursive: true });
    const tempPath = objectPath + ".tmp";
    try {
      const writeStream = createWriteStream(tempPath);
      const gzip = createGzip();
      await pipeline(
        [content],
        gzip,
        writeStream
      );
      await rename(tempPath, objectPath);
      return hash;
    } catch (error) {
      try {
        await rename(tempPath, tempPath);
      } catch {
      }
      throw error;
    }
  }
  /**
   * Retrieve a charge object by its hash
   */
  async getCharge(hash) {
    const objectPath = this.getObjectPath(hash);
    if (!existsSync(objectPath)) {
      return null;
    }
    try {
      const readStream = createReadStream(objectPath);
      const gunzip = createGunzip();
      const chunks = [];
      await pipeline(
        readStream,
        gunzip,
        async function* (source) {
          for await (const chunk of source) {
            chunks.push(chunk);
          }
        }
      );
      const content = Buffer.concat(chunks).toString("utf8");
      const charge = JSON.parse(content);
      return {
        id: hash,
        ...charge
      };
    } catch (error) {
      throw new Error(`Failed to read charge ${hash}: ${error}`);
    }
  }
  /**
   * Update a reference (HEAD pointer for context)
   */
  async updateRef(context, hash) {
    const refPath = join(this.refsDir, `${context.replace("/", "_")}`);
    await mkdir(dirname(refPath), { recursive: true });
    await writeFile(refPath, hash);
  }
  /**
   * Get the HEAD reference for a context
   */
  async getRef(context) {
    const refPath = join(this.refsDir, `${context.replace("/", "_")}`);
    if (!existsSync(refPath)) {
      return null;
    }
    try {
      const content = await readFile(refPath, "utf8");
      return content.trim();
    } catch {
      return null;
    }
  }
  /**
   * Get the current context
   */
  getCurrentContext() {
    const currentContextPath = join(this.gigDir, "current-context");
    if (!existsSync(currentContextPath)) {
      return "default";
    }
    try {
      return readFileSync(currentContextPath, "utf8").trim();
    } catch {
      return "default";
    }
  }
  /**
   * Set the current context
   */
  async setCurrentContext(context) {
    const currentContextPath = join(this.gigDir, "current-context");
    await writeFile(currentContextPath, context);
  }
  /**
   * Check if a context exists
   */
  contextExists(context) {
    const refPath = join(this.refsDir, `${context.replace("/", "_")}`);
    return existsSync(refPath);
  }
  /**
   * Get all contexts
   */
  async getAllContexts() {
    try {
      const { readdir } = await import("fs/promises");
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
    const current = this.getCurrentContext();
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
   * Update a charge's state in-place (simple approach for MVP)
   */
  async updateChargeState(chargeId, newState) {
    const charge = await this.getCharge(chargeId);
    if (!charge) {
      throw new Error(`Charge ${chargeId} not found`);
    }
    charge.state = newState;
    const objectPath = this.getObjectPath(chargeId);
    const content = JSON.stringify({ ...charge, id: void 0 }, null, 2);
    const tempPath = objectPath + ".tmp";
    try {
      const { createWriteStream: createWriteStream2 } = await import("fs");
      const { createGzip: createGzip2 } = await import("zlib");
      const { pipeline: pipeline2 } = await import("stream/promises");
      const writeStream = createWriteStream2(tempPath);
      const gzip = createGzip2();
      await pipeline2(
        [content],
        gzip,
        writeStream
      );
      await rename(tempPath, objectPath);
    } catch (error) {
      try {
        await rename(tempPath, tempPath);
      } catch {
      }
      throw error;
    }
  }
};

// src/lib/context.ts
var WorkspaceManager = class {
  storage;
  constructor(storage) {
    this.storage = storage;
  }
  /**
   * Get the current workspace
   */
  async getCurrentWorkspace() {
    return this.storage.getCurrentContext();
  }
  /**
   * Switch to a different workspace
   */
  async switchWorkspace(context) {
    if (!this.isValidContextName(context)) {
      throw new Error(`Invalid workspace name: ${context}. Use format like 'client/project' or 'default'`);
    }
    if (context !== "default" && !this.storage.contextExists(context)) {
      throw new Error(`Workspace '${context}' does not exist. Use 'gig switch -c ${context}' to create it.`);
    }
    await this.storage.setCurrentContext(context);
  }
  /**
   * Create a new workspace and switch to it
   */
  async createWorkspace(context) {
    if (!this.isValidContextName(context)) {
      throw new Error(`Invalid workspace name: ${context}. Use format like 'client/project' or 'default'`);
    }
    if (this.storage.contextExists(context)) {
      throw new Error(`Workspace '${context}' already exists`);
    }
    await this.storage.updateRef(context, "");
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
   * Check if a workspace exists
   */
  workspaceExists(context) {
    if (context === "default") {
      return true;
    }
    return this.storage.contextExists(context);
  }
  /**
   * Validate workspace name format
   */
  isValidContextName(context) {
    const validPattern = /^[a-zA-Z0-9@_-]+(?:\/[a-zA-Z0-9@_-]+)*$/;
    if (!context || context.length === 0) {
      return false;
    }
    if (context.startsWith("/") || context.endsWith("/")) {
      return false;
    }
    if (context.includes("//")) {
      return false;
    }
    return validPattern.test(context);
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
      lastCharge: lastCharge?.summary
    };
  }
  /**
   * Get all workspaces with their information
   */
  async getAllWorkspacesInfo() {
    const contexts = await this.listWorkspaces();
    const contextInfos = [];
    for (const context of contexts) {
      const info = await this.getWorkspaceInfo(context);
      contextInfos.push(info);
    }
    return contextInfos;
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
    throw new Error("Workspace deletion not yet implemented. Manually remove the ref file if needed.");
  }
  /**
   * Parse workspace patterns for filtering
   * Supports wildcards like @acme-* or client/*
   */
  parseWorkspacePattern(pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\\]\\]/g, "\\$&");
    const regexPattern = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
    return new RegExp(`^${regexPattern}$`);
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

// src/lib/config.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, mkdirSync as mkdirSync2 } from "fs";
import { writeFile as writeFile2, mkdir as mkdir2 } from "fs/promises";
import { join as join2, dirname as dirname2 } from "path";
import { homedir as homedir2 } from "os";
var Config = class {
  gigDir;
  globalConfigPath;
  contextManager;
  constructor(contextManager) {
    this.contextManager = contextManager;
    this.gigDir = process.env.GIG_CONFIG_PATH || join2(homedir2(), ".gig");
    this.globalConfigPath = join2(this.gigDir, "config.json");
    this.ensureGigDirectory();
  }
  ensureGigDirectory() {
    if (!existsSync2(this.gigDir)) {
      mkdirSync2(this.gigDir, { recursive: true });
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
   * Load configuration from a file
   */
  loadConfig(filePath) {
    if (!existsSync2(filePath)) {
      return {};
    }
    try {
      const content = readFileSync2(filePath, "utf8");
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to parse config file ${filePath}: ${error}`);
    }
  }
  /**
   * Save configuration to a file
   */
  async saveConfig(filePath, config) {
    const dir = dirname2(filePath);
    await mkdir2(dir, { recursive: true });
    const content = JSON.stringify(config, null, 2);
    await writeFile2(filePath, content);
  }
  /**
   * Load global configuration
   */
  loadGlobalConfig() {
    return this.loadConfig(this.globalConfigPath);
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
  loadContextConfig(context) {
    const contextConfigPath = this.getContextConfigPath(context);
    return this.loadConfig(contextConfigPath);
  }
  /**
   * Save context-specific configuration
   */
  async saveContextConfig(context, config) {
    const contextConfigPath = this.getContextConfigPath(context);
    await this.saveConfig(contextConfigPath, config);
  }
  /**
   * Set a configuration value
   */
  async set(key, value, global = false) {
    const parsedValue = this.parseValue(value);
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
    const contextValue = this.getContextValue(targetContext, key);
    if (contextValue !== void 0) {
      return contextValue;
    }
    const globalValue = this.getGlobalValue(key);
    if (globalValue !== void 0) {
      return globalValue;
    }
    return void 0;
  }
  /**
   * Set a global configuration value
   */
  async setGlobalValue(key, value) {
    const config = this.loadGlobalConfig();
    this.setNestedValue(config, key, value);
    await this.saveGlobalConfig(config);
  }
  /**
   * Get a global configuration value
   */
  getGlobalValue(key) {
    const config = this.loadGlobalConfig();
    return this.getNestedValue(config, key);
  }
  /**
   * Set a context-specific configuration value
   */
  async setContextValue(context, key, value) {
    const config = this.loadContextConfig(context);
    this.setNestedValue(config, key, value);
    await this.saveContextConfig(context, config);
  }
  /**
   * Get a context-specific configuration value
   */
  getContextValue(context, key) {
    const config = this.loadContextConfig(context);
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
      if (!(part in current) || typeof current[part] !== "object") {
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
      if (current === null || current === void 0 || typeof current !== "object") {
        return void 0;
      }
      current = current[part];
    }
    return typeof current === "string" || typeof current === "number" || typeof current === "boolean" ? current : void 0;
  }
  /**
   * Parse a string value to appropriate type
   */
  parseValue(value) {
    if (typeof value !== "string") {
      return value;
    }
    const num = parseFloat(value);
    if (!isNaN(num) && isFinite(num) && value.trim() === num.toString()) {
      return num;
    }
    const lower = value.toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
    return value;
  }
  /**
   * List all configuration keys and values for current context
   */
  async list(context) {
    const targetContext = context || await this.contextManager.getCurrentWorkspace();
    const result = {};
    const globalConfig = this.loadGlobalConfig();
    this.flattenConfig(globalConfig, result, "global");
    const contextConfig = this.loadContextConfig(targetContext);
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

// src/lib/charge.ts
import { execSync } from "child_process";
import { writeFileSync as writeFileSync3, readFileSync as readFileSync3, unlinkSync } from "fs";
import { createInterface } from "readline";
import { tmpdir } from "os";
import { join as join3 } from "path";
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
    const context = this.storage.getCurrentContext();
    if (isNaN(options.units) || options.units <= 0) {
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
    const tempFile = join3(tmpdir(), `gig-charge-${Date.now()}.yml`);
    writeFileSync3(tempFile, template);
    try {
      execSync(`${editor} "${tempFile}"`, { stdio: "inherit" });
      const content = readFileSync3(tempFile, "utf8");
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
    let gitCommits = [];
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
    const targetContext = context || this.storage.getCurrentContext();
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
   * Validate charge data
   */
  validateChargeData(data) {
    if (!data.summary || data.summary.trim().length === 0) {
      throw new Error("Summary is required");
    }
    if (!data.units || isNaN(data.units) || data.units <= 0) {
      throw new Error("Units must be a positive number");
    }
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
      if (isNaN(units) || units <= 0) {
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
          const selection = await this.askQuestion(rl, 'Select commits (comma-separated numbers, or "all"): ');
          if (selection.toLowerCase() === "all") {
            gitCommits = recentCommits.map((c) => c.hash);
          } else {
            const indices = selection.split(",").map((s) => parseInt(s.trim()) - 1);
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
      filteredCharges = filteredCharges.filter(
        (charge) => new Date(charge.timestamp) >= sinceDate
      );
    }
    if (filters.before) {
      const beforeDate = this.parseTimeFilter(filters.before);
      filteredCharges = filteredCharges.filter(
        (charge) => new Date(charge.timestamp) <= beforeDate
      );
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
      if (!isNaN(min) && !isNaN(max)) {
        return units >= min && units <= max;
      }
    }
    if (unitsFilter.startsWith(">=")) {
      const value = parseFloat(unitsFilter.slice(2));
      return !isNaN(value) && units >= value;
    }
    if (unitsFilter.startsWith("<=")) {
      const value = parseFloat(unitsFilter.slice(2));
      return !isNaN(value) && units <= value;
    }
    if (unitsFilter.startsWith(">")) {
      const value = parseFloat(unitsFilter.slice(1));
      return !isNaN(value) && units > value;
    }
    if (unitsFilter.startsWith("<")) {
      const value = parseFloat(unitsFilter.slice(1));
      return !isNaN(value) && units < value;
    }
    const exactValue = parseFloat(unitsFilter);
    return !isNaN(exactValue) && units === exactValue;
  }
  /**
   * Parse time filter into Date
   * Supports: "7d", "2w", "1m", "2025-09-01", "2025-09-01T10:00:00Z"
   */
  parseTimeFilter(timeFilter) {
    const now = /* @__PURE__ */ new Date();
    if (timeFilter.endsWith("d")) {
      const days = parseInt(timeFilter.slice(0, -1));
      return new Date(now.getTime() - days * 24 * 60 * 60 * 1e3);
    }
    if (timeFilter.endsWith("w")) {
      const weeks = parseInt(timeFilter.slice(0, -1));
      return new Date(now.getTime() - weeks * 7 * 24 * 60 * 60 * 1e3);
    }
    if (timeFilter.endsWith("m")) {
      const months = parseInt(timeFilter.slice(0, -1));
      const result = new Date(now);
      result.setMonth(result.getMonth() - months);
      return result;
    }
    if (timeFilter.endsWith("y")) {
      const years = parseInt(timeFilter.slice(0, -1));
      const result = new Date(now);
      result.setFullYear(result.getFullYear() - years);
      return result;
    }
    const parsed = new Date(timeFilter);
    if (!isNaN(parsed.getTime())) {
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

// src/lib/git.ts
import { execSync as execSync2 } from "child_process";
import { existsSync as existsSync3 } from "fs";
import { resolve, join as join4 } from "path";
var GitIntegration = class {
  config;
  constructor(config) {
    this.config = config;
  }
  /**
   * Check if a directory is a git repository
   */
  isGitRepository(path) {
    const gitDir = join4(path, ".git");
    return existsSync3(gitDir);
  }
  /**
   * Get recent commits from a git repository
   */
  getCommitsFromRepo(repoPath, count = 10) {
    try {
      const resolvedPath = resolve(repoPath);
      if (!this.isGitRepository(resolvedPath)) {
        return [];
      }
      const gitCommand = `git log --oneline --format="%H|%s|%an|%ad" --date=iso -n ${count}`;
      const output = execSync2(gitCommand, {
        cwd: resolvedPath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
        // Ignore stderr to suppress git warnings
      });
      const commits = [];
      const lines = output.trim().split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        const [hash, subject, author, date] = line.split("|");
        if (hash && subject) {
          commits.push({
            hash: hash.trim(),
            subject: subject.trim(),
            author: author?.trim() || "Unknown",
            date: date?.trim() || "",
            repository: repoPath
          });
        }
      }
      return commits;
    } catch (error) {
      return [];
    }
  }
  /**
   * Get recent commits from all configured repositories
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
    const allCommits = [];
    for (const repo of repositories) {
      const commits = this.getCommitsFromRepo(repo, count);
      allCommits.push(...commits);
    }
    return allCommits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, count);
  }
  /**
   * Get commits from a specific repository
   */
  async getCommitsFromRepository(repoPath, count = 10) {
    return this.getCommitsFromRepo(repoPath, count);
  }
  /**
   * Check if a commit exists in any configured repository
   */
  async commitExists(commitHash) {
    const repositories = await this.config.getRepositories();
    const reposToCheck = repositories.length > 0 ? repositories : [process.cwd()];
    for (const repo of reposToCheck) {
      try {
        const resolvedPath = resolve(repo);
        if (!this.isGitRepository(resolvedPath)) {
          continue;
        }
        execSync2(`git show --no-patch ${commitHash}`, {
          cwd: resolvedPath,
          stdio: ["ignore", "ignore", "ignore"]
        });
        return { exists: true, repository: repo };
      } catch {
        continue;
      }
    }
    return { exists: false };
  }
  /**
   * Get commit details by hash
   */
  async getCommitDetails(commitHash) {
    const { exists, repository } = await this.commitExists(commitHash);
    if (!exists || !repository) {
      return null;
    }
    try {
      const resolvedPath = resolve(repository);
      const output = execSync2(`git show --no-patch --format="%H|%s|%an|%ad" --date=iso ${commitHash}`, {
        cwd: resolvedPath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      });
      const line = output.trim();
      const [hash, subject, author, date] = line.split("|");
      return {
        hash: hash.trim(),
        subject: subject.trim(),
        author: author?.trim() || "Unknown",
        date: date?.trim() || "",
        repository
      };
    } catch {
      return null;
    }
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
        const commitsByRepo = commits.reduce((acc, commit) => {
          const repoName = this.getRepoName(commit.repository);
          if (!acc[repoName]) {
            acc[repoName] = [];
          }
          acc[repoName].push(commit);
          return acc;
        }, {});
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
   * List all configured repositories with their status
   */
  async listRepositories() {
    const repositories = await this.config.getRepositories();
    const result = [];
    for (const repo of repositories) {
      const resolvedPath = resolve(repo);
      const exists = existsSync3(resolvedPath);
      const isGitRepo = exists ? this.isGitRepository(resolvedPath) : false;
      let commitCount;
      if (isGitRepo) {
        try {
          const commits = this.getCommitsFromRepo(resolvedPath, 1e3);
          commitCount = commits.length;
        } catch {
          commitCount = 0;
        }
      }
      result.push({
        path: repo,
        exists,
        isGitRepo,
        commitCount
      });
    }
    return result;
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
    const pkg = JSON.parse(readFileSync4(packagePath, "utf8"));
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
async function handleMark(chargeManager, args, flags) {
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
      matches.forEach((charge2) => console.error(`  ${charge2.id.slice(0, 7)} - ${charge2.summary}`));
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
