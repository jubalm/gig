# Advanced Use Cases

Beyond basic work tracking, Gig CLI's flexible architecture enables sophisticated business organization and powerful AI integration.

## Claude Code Integration

### Natural Language Interface with `/gig` Slash Command

The real power comes from using Claude Code as your natural language interface to Gig CLI:

**`.claude/commands/gig.md`**:
```markdown
---
description: Natural language interface to Gig CLI for business management
tools: [Bash, Read, Write]
---
You are an expert with the Gig CLI tool. The user wants to: $ARGUMENTS

First run `gig --help` to understand available commands, then complete the user's request.
Handle complex queries that might require multiple workspace switches, calculations, and cross-context analysis.
```

### Examples of Natural Language Queries

```bash
/gig show me unbilled work across all clients sorted by value
/gig what's my effective hourly rate for the past month?
/gig create a charge for the OAuth work I just committed
/gig find all charges related to authentication features
/gig which client has the most unbilled work over 2 weeks old?
/gig workspace to my highest paying client and show recent work
/gig calculate my total revenue this quarter across all workspaces
```

### Why This Works Better Than Pure CLI

**Complex Cross-Context Queries:**
```bash
# This would be tedious in pure CLI
gig workspace client-a && gig collect mark:unmarked
gig workspace client-b && gig collect mark:unmarked
gig workspace client-c && gig collect mark:unmarked
# ...then manually compare rates and totals

# With Claude Code:
/gig compare unbilled work across all clients
```

**Business Intelligence Claude Provides:**
```bash
/gig analyze my profitability trends by client type
/gig suggest which clients I should prioritize based on rates
/gig identify patterns in my most valuable work
/gig draft an email explaining rate increase to startup client
```

### Specialized Subagents for Business Workflows

**Invoice Assistant Subagent:**
```markdown
# .claude/subagents/invoice-assistant.md
---
description: Generates professional invoices from gig data
tools: [Bash, Read, Write, Edit]
---
I help generate invoices by:
1. Switching to the correct client workspace
2. Collecting all collectible charges
3. Calculating totals with workspace-specific rates
4. Generating professional invoice document
5. Drafting email with invoice attached
6. Updating charges to 'billed' status
```

**Business Analyst Subagent:**
```markdown
# .claude/subagents/business-analyst.md
---
description: Provides insights and analysis of freelance business
tools: [Bash, Read, Write]
---
I analyze your gig data to provide:
- Client profitability analysis
- Effective hourly rate calculations
- Work pattern insights
- Revenue forecasting
- Optimization recommendations
```

### Real Workflows You Can Use Today

**Invoice Generation:**
```bash
# Just tell Claude what you want
/gig generate invoice for acme-corp including all work since March 1st

# Claude handles:
# - gig workspace acme-corp/website
# - gig collect since:2025-03-01 mark:collectible
# - Rate calculations
# - Professional invoice document creation
# - Email draft with payment terms
# - gig mark [charges] billed
```

**Business Analysis:**
```bash
/gig show me which types of work are most profitable

# Claude analyzes:
# - All workspaces and their rates
# - Time spent vs revenue generated
# - Patterns in high-value vs low-value work
# - Recommendations for focusing efforts
```

**Smart Work Tracking:**
```bash
/gig create charge for the auth bug I just fixed

# Claude understands:
# - Current git context and recent commits
# - Which client workspace you're in
# - Appropriate charge description from commit messages
# - Estimated effort based on code complexity
```

## Custom Workspace Patterns

The real power of Gig CLI comes from sophisticated workspace organization that matches your business structure.

### Statement of Work Tracking

```bash
# Organize by contract/SOW
gig workspace -c @acme-corp/website-redesign/sow-2025-03
gig config rate 175
gig config client "Acme Corp - Website Team"
gig charge -m "Header redesign with new brand guidelines" -u 3

# Different SOW, different rate
gig workspace -c @acme-corp/api-integration/sow-2025-04
gig config rate 200  # Higher rate for backend work
gig charge -m "Payment gateway integration" -u 4
```

### Fiscal Organization

```bash
# Track by fiscal periods for easy reporting
gig workspace -c @client/2025-q1/mobile-app
gig workspace -c @client/2025-q2/web-platform
gig workspace -c @client/2025-q2/maintenance

# Quarterly reports become simple
gig collect workspace:*/2025-q1/* --json > q1-revenue.json
```

### Contract-Based Billing

```bash
# Different contracts with the same client
gig workspace -c @techcorp/contract-hourly/feature-development
gig config rate 180

gig workspace -c @techcorp/contract-fixed/security-audit
gig config rate 0  # Fixed fee, track time for analysis

# Later, analyze which contract types are more profitable
gig collect workspace:@techcorp/contract-hourly/* since:90d
gig collect workspace:@techcorp/contract-fixed/* since:90d
```

### Project Phase Management

```bash
# Track phases separately for milestone billing
gig workspace -c @startup/mvp/phase-1-auth
gig config rate 160
gig charge -m "User registration and login" -u 6

gig workspace -c @startup/mvp/phase-2-dashboard
gig charge -m "Analytics dashboard with charts" -u 8

# Bill by completed phases
gig collect workspace:@startup/mvp/phase-1-* mark:collectible --json
```

### Multi-Role Tracking

```bash
# Different roles, different rates
gig workspace -c @agency/development/client-work
gig config rate 150

gig workspace -c @agency/consultation/architecture-review
gig config rate 250

gig workspace -c @agency/management/team-leadership
gig config rate 200

# See role profitability
gig collect workspace:@agency/development/* since:30d
gig collect workspace:@agency/consultation/* since:30d
```

## Simple Automation That Works Today

### Git Hooks for Work Tracking

```bash
# .git/hooks/post-commit
#!/bin/bash
# Remind to track work after significant commits

COMMIT_MSG=$(git log -1 --pretty=%s)
LINES_CHANGED=$(git diff HEAD~1 --numstat | awk '{sum+=$1+$2} END {print sum}')

if [ "$LINES_CHANGED" -gt 50 ]; then
  echo "📊 Significant changes detected ($LINES_CHANGED lines)"
  echo "💰 Don't forget: gig charge -m \"$COMMIT_MSG\" -u [hours]"
fi
```

### Bash Aliases for Common Workflows

```bash
# Add to your .bashrc/.zshrc
alias gig-status='gig workspace && echo "Unbilled work:" && gig collect'
alias gig-weekly='gig collect since:7d --json'
alias gig-bill='gig collect mark:unmarked'
alias gig-invoice='gig collect mark:collectible'

# Quick charge with git context
function gigit() {
  local message=${1:-$(git log -1 --pretty=%s)}
  local hours=${2:-1}
  gig charge -m "$message" -u $hours
}
```

### Simple Reporting Scripts

```bash
#!/bin/bash
# weekly-report.sh - Simple weekly summary

echo "=== WEEKLY GIG REPORT ==="
echo "Current Workspace: $(gig workspace)"
echo ""

echo "This Week's Work:"
gig collect since:7d

echo ""
echo "Ready to Bill:"
gig collect mark:collectible

echo ""
echo "Workspaces with Recent Activity:"
gig collect since:7d --json | jq -r '.charges | group_by(.workspace) | .[] | "\(.[0].workspace): \(length) charges"'
```

---

*Gig CLI grows with your business. Start simple, add sophistication as your needs evolve - all while keeping your data local and your workflow terminal-native.*