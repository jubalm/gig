#!/usr/bin/env node

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Import our modules
import { Storage } from './lib/storage';
import { WorkspaceManager } from './lib/context';
import { Config } from './lib/config';
import { ChargeManager } from './lib/charge';
import { Collector } from './lib/collect';
import { GitIntegration } from './lib/git';

interface CliArgs {
  command: string;
  subcommand?: string;
  args: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(): CliArgs {
  const [,, ...allArgs] = process.argv;

  if (allArgs.length === 0) {
    showHelp();
    process.exit(0);
  }

  const args: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let command = '';

  for (let i = 0; i < allArgs.length; i++) {
    const arg = allArgs[i];

    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      flags[key] = value || true;
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      const next = allArgs[i + 1];

      // Special handling for boolean flags that don't take values
      if (key === 'c' || key === 'help' || key === 'h' || key === 'version' || key === 'v' || key === 'global' || key === 'json' || key === 'csv') {
        flags[key] = true;
      } else if (next && !next.startsWith('-')) {
        flags[key] = next;
        i++; // Skip the value
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
  const __dirname = dirname(__filename);
  const packagePath = join(__dirname, 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
    console.log(`gig version ${pkg.version}`);
  } catch {
    console.log('gig version unknown');
  }
}

async function main() {
  const { command, subcommand, args, flags } = parseArgs();

  // Handle help and version
  if (flags.help || flags.h) {
    showHelp();
    return;
  }

  if (flags.version || flags.v || command === 'version') {
    showVersion();
    return;
  }

  try {
    // Initialize core systems
    const storage = new Storage();
    const contextManager = new WorkspaceManager(storage);
    const config = new Config(contextManager);
    const git = new GitIntegration(config);
    const chargeManager = new ChargeManager(storage, config, git);
    const collector = new Collector(storage, config);

    // Route commands
    switch (command) {
      case 'workspace':
      case 'ws':
        await handleWorkspace(contextManager, subcommand, flags);
        break;

      case 'config':
        await handleConfig(config, args, flags);
        break;

      case 'charge':
        await handleCharge(chargeManager, flags);
        break;

      case 'collect':
        await handleCollect(collector, args, flags);
        break;

      case 'mark':
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

// TODO: Future enhancement - shell completions
// - Complete workspace names for: gig workspace <TAB>
// - Complete states for: gig mark <id> <TAB>
// - Complete filter prefixes for: gig collect <TAB>
// Consider using a --completions flag to generate completion scripts

async function handleWorkspace(contextManager: WorkspaceManager, workspace: string | undefined, flags: Record<string, any>) {
  // Create new workspace
  if (flags.c) {
    if (!workspace) {
      console.error('Error: Workspace name required when creating');
      console.error('Usage: gig workspace -c <name>');
      process.exit(1);
    }
    await contextManager.createWorkspace(workspace);
    console.log(`Created and switched to workspace: ${workspace}`);
    return;
  }

  // Switch to existing workspace
  if (workspace) {
    await contextManager.switchWorkspace(workspace);
    console.log(`Switched to workspace: ${workspace}`);
    return;
  }

  // List all workspaces (default behavior)
  const workspaces = await contextManager.listWorkspaces();
  const current = await contextManager.getCurrentWorkspace();

  for (const ws of workspaces) {
    const marker = ws === current ? '* ' : '  ';
    console.log(`${marker}${ws}`);
  }
}

async function handleConfig(config: Config, args: string[], flags: Record<string, any>) {
  if (args.length === 0) {
    console.error('Error: Config key required');
    console.error('Usage: gig config <key> [value] [--global]');
    process.exit(1);
  }

  const [key, ...valueParts] = args;
  const value = valueParts.join(' ');

  if (value) {
    await config.set(key, value, flags.global);
    console.log(`Set ${key} = ${value}`);
  } else {
    const result = await config.get(key);
    console.log(result || '(not set)');
  }
}

async function handleCharge(chargeManager: ChargeManager, flags: Record<string, any>) {
  if (flags.m && flags.u) {
    // Quick mode
    await chargeManager.createCharge({
      summary: flags.m as string,
      units: parseFloat(flags.u as string)
    });
    console.log('Charge created');
  } else {
    // Editor mode
    await chargeManager.createChargeInteractive();
  }
}

async function handleCollect(collector: Collector, args: string[], flags: Record<string, any>) {
  const filters = args.join(' ');

  // Determine output format
  let format: 'table' | 'json' | 'csv' = 'table';
  if (flags.json) format = 'json';
  if (flags.csv) format = 'csv';

  const output = await collector.getFormattedCollection(filters, format);
  console.log(output);
}

async function handleMark(chargeManager: ChargeManager, args: string[], flags: Record<string, any>) {
  if (args.length < 2) {
    console.error('Error: Charge ID and state required');
    console.error('Usage: gig mark <id> <state>');
    process.exit(1);
  }

  const [ids, state] = args;
  const chargeIds = ids.split(',');
  let markedCount = 0;

  for (const id of chargeIds) {
    const partialId = id.trim();

    // Find charge by partial ID
    const matches = await chargeManager.findChargeById(partialId);

    if (matches.length === 0) {
      console.error(`Error: No charge found matching ID ${partialId}`);
      continue;
    }

    if (matches.length > 1) {
      console.error(`Error: Multiple charges match ID ${partialId}:`);
      matches.forEach(charge => console.error(`  ${charge.id.slice(0, 7)} - ${charge.summary}`));
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

// Run the CLI
main().catch(error => {
  console.error(`Fatal error: ${error}`);
  process.exit(1);
});