import { Storage } from './storage';
import type { ChargeObject } from './storage';
import { Config } from './config';
import { WorkspaceManager } from './context';

export interface CollectionResult {
  charges: ChargeObject[];
  aggregates: {
    count: number;
    total_units: number;
    total_amount: number;
    avg_units: number;
    workspaces: number;
  };
}

interface FilterCriteria {
  state?: string;
  context?: string;
  units?: string;
  since?: string;
  before?: string;
  summary?: string;
}

export class Collector {
  private storage: Storage;
  private config: Config;

  constructor(storage: Storage, config: Config) {
    this.storage = storage;
    this.config = config;
  }

  /**
   * Collect charges with optional filtering
   */
  async collect(filterString?: string): Promise<CollectionResult> {
    const filters = this.parseFilters(filterString || '');
    const allCharges = await this.storage.findCharges();

    // Apply filters
    let filteredCharges = allCharges;

    if (filters.state) {
      filteredCharges = filteredCharges.filter(charge =>
        this.matchesStateFilter(charge, filters.state!)
      );
    }

    if (filters.context) {
      filteredCharges = filteredCharges.filter(charge =>
        this.matchesContextFilter(charge, filters.context!)
      );
    }

    if (filters.units) {
      filteredCharges = filteredCharges.filter(charge =>
        this.matchesUnitsFilter(charge, filters.units!)
      );
    }

    if (filters.since) {
      const sinceDate = this.parseTimeFilter(filters.since);
      filteredCharges = filteredCharges.filter(charge =>
        new Date(charge.timestamp) >= sinceDate
      );
    }

    if (filters.before) {
      const beforeDate = this.parseTimeFilter(filters.before);
      filteredCharges = filteredCharges.filter(charge =>
        new Date(charge.timestamp) <= beforeDate
      );
    }

    if (filters.summary) {
      const searchTerm = filters.summary.toLowerCase();
      filteredCharges = filteredCharges.filter(charge =>
        charge.summary.toLowerCase().includes(searchTerm)
      );
    }

    // Default filter: unmarked charges only if no filters specified
    if (!filterString || filterString.trim() === '') {
      filteredCharges = filteredCharges.filter(charge => charge.state === 'unmarked');
    }

    // Sort by timestamp (newest first)
    filteredCharges.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Calculate aggregates
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
  private parseFilters(filterString: string): FilterCriteria {
    const filters: FilterCriteria = {};

    if (!filterString.trim()) {
      return filters;
    }

    // Split on spaces but respect quoted values
    const parts = this.splitFilterString(filterString);

    for (const part of parts) {
      const [key, value] = part.split(':', 2);

      if (!key || !value) continue;

      const cleanValue = value.replace(/^["']|["']$/g, ''); // Remove quotes

      switch (key.toLowerCase()) {
        case 'mark':
        case 'state':
          filters.state = cleanValue;
          break;
        case 'workspace':
          filters.context = cleanValue;
          break;
        case 'units':
          filters.units = cleanValue;
          break;
        case 'since':
          filters.since = cleanValue;
          break;
        case 'before':
          filters.before = cleanValue;
          break;
        case 'summary':
        case 'message':
          filters.summary = cleanValue;
          break;
      }
    }

    return filters;
  }

  /**
   * Split filter string respecting quoted values
   */
  private splitFilterString(filterString: string): string[] {
    const parts: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < filterString.length; i++) {
      const char = filterString[i];

      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
        current += char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        current += char;
      } else if (char === ' ' && !inQuotes) {
        if (current.trim()) {
          parts.push(current.trim());
          current = '';
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
  private matchesStateFilter(charge: ChargeObject, stateFilter: string): boolean {
    return charge.state === stateFilter;
  }

  /**
   * Check if charge matches context filter (supports wildcards)
   */
  private matchesContextFilter(charge: ChargeObject, contextFilter: string): boolean {
    // Handle wildcards
    if (contextFilter.includes('*')) {
      const pattern = contextFilter
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      const regex = new RegExp(`^${pattern}$`);
      return regex.test(charge.context);
    }

    // Exact match
    return charge.context === contextFilter;
  }

  /**
   * Check if charge matches units filter
   * Supports: ">2", ">=3", "<5", "<=4", "2.5", "2-5"
   */
  private matchesUnitsFilter(charge: ChargeObject, unitsFilter: string): boolean {
    const units = charge.units;

    // Range filter (e.g., "2-5")
    if (unitsFilter.includes('-')) {
      const [min, max] = unitsFilter.split('-').map(s => parseFloat(s.trim()));
      if (!isNaN(min) && !isNaN(max)) {
        return units >= min && units <= max;
      }
    }

    // Comparison filters
    if (unitsFilter.startsWith('>=')) {
      const value = parseFloat(unitsFilter.slice(2));
      return !isNaN(value) && units >= value;
    }

    if (unitsFilter.startsWith('<=')) {
      const value = parseFloat(unitsFilter.slice(2));
      return !isNaN(value) && units <= value;
    }

    if (unitsFilter.startsWith('>')) {
      const value = parseFloat(unitsFilter.slice(1));
      return !isNaN(value) && units > value;
    }

    if (unitsFilter.startsWith('<')) {
      const value = parseFloat(unitsFilter.slice(1));
      return !isNaN(value) && units < value;
    }

    // Exact match
    const exactValue = parseFloat(unitsFilter);
    return !isNaN(exactValue) && units === exactValue;
  }

  /**
   * Parse time filter into Date
   * Supports: "7d", "2w", "1m", "2025-09-01", "2025-09-01T10:00:00Z"
   */
  private parseTimeFilter(timeFilter: string): Date {
    const now = new Date();

    // Relative time filters
    if (timeFilter.endsWith('d')) {
      const days = parseInt(timeFilter.slice(0, -1));
      return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    }

    if (timeFilter.endsWith('w')) {
      const weeks = parseInt(timeFilter.slice(0, -1));
      return new Date(now.getTime() - weeks * 7 * 24 * 60 * 60 * 1000);
    }

    if (timeFilter.endsWith('m')) {
      const months = parseInt(timeFilter.slice(0, -1));
      const result = new Date(now);
      result.setMonth(result.getMonth() - months);
      return result;
    }

    if (timeFilter.endsWith('y')) {
      const years = parseInt(timeFilter.slice(0, -1));
      const result = new Date(now);
      result.setFullYear(result.getFullYear() - years);
      return result;
    }

    // Absolute date
    const parsed = new Date(timeFilter);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }

    throw new Error(`Invalid time filter: ${timeFilter}`);
  }

  /**
   * Calculate aggregates for a collection of charges
   */
  private async calculateAggregates(charges: ChargeObject[]): Promise<{
    count: number;
    total_units: number;
    total_amount: number;
    avg_units: number;
    workspaces: number;
  }> {
    const count = charges.length;
    const total_units = charges.reduce((sum, charge) => sum + charge.units, 0);
    const workspaces = new Set(charges.map(charge => charge.context)).size;
    const avg_units = count > 0 ? total_units / count : 0;

    // Calculate total amount (requires rates for each context)
    let total_amount = 0;
    const contextRates = new Map<string, number>();

    for (const charge of charges) {
      if (!contextRates.has(charge.context)) {
        const rate = await this.config.getRate(charge.context);
        contextRates.set(charge.context, rate || 0);
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
  formatCharges(charges: ChargeObject[], format: 'table' | 'json' | 'csv' = 'table'): string {
    if (format === 'json') {
      return JSON.stringify(charges, null, 2);
    }

    if (format === 'csv') {
      const headers = ['id', 'context', 'summary', 'units', 'state', 'timestamp'];
      const rows = charges.map(charge => [
        charge.id,
        charge.context,
        `"${charge.summary.replace(/"/g, '""')}"`, // Escape quotes in CSV
        charge.units.toString(),
        charge.state,
        charge.timestamp
      ]);

      return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    }

    // Table format (default)
    if (charges.length === 0) {
      return 'No charges found.';
    }

    const lines: string[] = [];

    for (const charge of charges) {
      const id = charge.id.slice(0, 7);
      const summary = charge.summary.padEnd(30).slice(0, 30);
      const units = charge.units.toString().padStart(6);
      const context = charge.context.padEnd(20).slice(0, 20);

      lines.push(`${id}  ${context}  ${summary}  ${units} units  [${charge.state}]`);
    }

    return lines.join('\n');
  }

  /**
   * Format aggregates for display
   */
  formatAggregates(aggregates: CollectionResult['aggregates']): string {
    return `Total: ${aggregates.count} charges, ${aggregates.total_units} units, $${aggregates.total_amount.toFixed(2)}`;
  }

  /**
   * Get collection with formatted output
   */
  async getFormattedCollection(
    filterString?: string,
    format: 'table' | 'json' | 'csv' = 'table'
  ): Promise<string> {
    const result = await this.collect(filterString);

    if (format === 'json') {
      return JSON.stringify(result, null, 2);
    }

    const chargesOutput = this.formatCharges(result.charges, format);

    if (format === 'csv') {
      return chargesOutput;
    }

    // Table format includes aggregates
    const aggregatesOutput = this.formatAggregates(result.aggregates);

    return result.charges.length > 0
      ? `${chargesOutput}\n\n${aggregatesOutput}`
      : 'No charges found.';
  }

  /**
   * Show collection help
   */
  showCollectHelp(): void {
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
}