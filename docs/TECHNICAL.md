# Technical Architecture

## Overview

Gig CLI implements a Git-inspired content-addressed storage system for business data, using proven patterns from distributed version control applied to freelance work tracking.

## Core Architecture

### Content-Addressed Storage

Like Git, every charge is initially stored as an object addressed by its SHA-256 hash:

```
~/.gig/objects/
├── 5c/d355954833d29a5644d11bd29b063ecb25bc8b6f01a79fd9c8c2157edaf313
├── bb/2f61f20c88c29f79e680d0ba06c43d34eec935d0c3f4f3044bdcd5bec14575
└── ...
```

### Data Structure

**Charge Objects** are JSON documents compressed with zlib:
```json
{
  "summary": "Built OAuth integration with rate limiting",
  "units": 3.5,
  "timestamp": "2025-09-13T18:48:45.299Z",
  "git_commits": ["a1b2c3d", "b2c3d4e"],
  "parent": "def456abc...",
  "workspace": "acme-corp/website",
  "state": "unmarked"
}
```

### Reference System

Like Git refs, workspaces maintain pointers to their HEAD:
```
~/.gig/refs/
├── acme-corp_website -> 5cd355954833d29a...
├── startup_mobile -> bb2f61f20c88c29f...
└── default -> 742fa1b39dc75421...
```

## Storage Benefits

### Mutable State Management
- Charges can be updated in-place (e.g., mark as "paid")
- State changes overwrite the original file
- No audit trail of state transitions (trade-off for simplicity)

### Content-Addressed Storage
- Each charge gets unique hash based on initial content
- Includes timestamp, so duplicates are rare in practice
- Hash remains same even when charge content is modified

### Atomic Operations
- All writes use temp-file + rename pattern
- Either fully written or not at all
- No partial/corrupted state possible

## Security Model

### Local-Only Storage
- All data in `~/.gig/` directory
- No network calls, no telemetry
- Standard filesystem permissions
- Easy to backup, migrate, or inspect

### Zero Dependencies
- Only Node.js built-in modules
- No supply chain attack surface
- No version conflicts
- Fully auditable codebase

### Hash-Based Storage
- SHA-256 used for initial file naming
- Hash does not change when charge is modified
- Provides storage organization, not integrity verification
- Simple content-addressed approach without versioning

## Data Formats

### Internal Storage
- **Charges**: Compressed JSON objects
- **Config**: Plain JSON files
- **Refs**: Plain text files containing hashes

### Export Formats
- **JSON**: Structured data with aggregates
- **CSV**: Spreadsheet-compatible
- **Table**: Human-readable terminal output

## Performance Characteristics

### Read Performance
- O(1) charge lookup by hash
- O(log n) workspace switching
- Lazy loading of charge objects
- Efficient filesystem operations

### Write Performance
- Atomic writes prevent corruption
- Compression reduces I/O
- Only modified refs updated
- No database locking issues

### Scalability
- Designed for typical freelance workloads
- Linear scaling with charge count
- Simple filesystem operations
- Minimal memory footprint

## Configuration System

### Hierarchy
```
1. Workspace-specific: ~/.gig/contexts/client_project/config.json
2. Global: ~/.gig/config.json
3. Environment: GIG_CONFIG_PATH override
```

### Format
Standard JSON with nested keys:
```json
{
  "rate": 150,
  "client": "Acme Corporation",
  "repositories": [
    "/path/to/frontend",
    "/path/to/backend"
  ]
}
```

## Implementation Details

### Git Integration
- Uses `child_process.execSync` for git commands
- Parses commit history from configured repositories
- Links charges to actual git commits
- Validates commit existence before storage

### Workspace Management
- Namespaced with unlimited depth
- Pattern matching with wildcards
- Safe character encoding for filesystem
- Case-sensitive workspace names

### Filtering Engine
- Supports complex queries: `mark:collectible workspace:@acme-* units:">2"`
- Time-based filters: `since:7d`, `before:2025-01-01`
- Regex patterns for text matching
- Combinable filter expressions

## File System Layout

```
~/.gig/
├── config.json              # Global configuration
├── current-context          # Active workspace pointer (legacy filename)
├── objects/                 # Content-addressed storage
│   ├── 5c/
│   │   └── d355954833...    # Compressed charge objects
│   └── bb/
│       └── 2f61f20c88...
├── refs/                    # Context HEAD pointers
│   ├── default
│   ├── acme-corp_website
│   └── startup_mobile
└── contexts/                # Workspace-specific config (legacy dirname)
    ├── acme-corp_website/
    │   └── config.json
    └── startup_mobile/
        └── config.json
```

## Design Trade-offs

### Simplicity Over Features
- **Mutable state**: State changes overwrite files (no versioning) for simplicity
- **No audit trail**: Trade-off between complexity and ease of implementation
- **Hash stability**: Object hash doesn't change with mutations (not truly content-addressed)

### Performance Over Completeness
- **Linear search**: No indexing for complex queries (sufficient for typical use)
- **Simple storage**: Direct filesystem operations over database complexity
- **Minimal dependencies**: Only Node.js built-ins, no external libraries

---

*Pragmatic implementation focused on developer productivity over theoretical purity.*