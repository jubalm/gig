# Gig CLI

> **"You can code, but can you gig?"**

You just finished that authentication system. Three hours? Four? Who's counting... oh wait, you should be. Your client is.

You switch between three projects, but your brain only has one context. That spreadsheet for tracking work is somewhere—maybe in that folder, maybe in Slack. Last updated two weeks ago when you remembered you'd done a bunch of work but forgot to log it.

Your terminal is open. Your Git workflow is solid. Invoice time arrives—how many hours? For whom? What work exactly?

## It's as simple as Git

```bash
# I'm done with auth task, that was 4 hours work...
gig charge --message "Built OAuth with Google + GitHub" --units 4

# Now, let me switch to another client work... (command looks familiar?)
gig workspace -c acme-corp/website
gig charge --message "Responsive header that actually works" --units 2.5

# Alright, let me prepare the invoice...
gig collect                           # Shows unbilled work with totals
gig collect workspace:acme/* since:30d  # Last month's work for Acme
gig mark abc1234 collectible          # Ready for invoicing
gig collect --json > invoice.json     # Export and use the data for invoicing workflow
```

Track work as you go, get organized when needed, and ready for billing anytime. No enterprise bloat you don't need.

## Stay in the Flow

Switching to a dashboard breaks your flow. The best time to track work is right when you finish it—while the context is fresh, while your terminal is open. Gig lives where you work—always available, instantly responsive, never asking you to leave.

- **Works Offline** - always available, runs instantly, no auth
- **Command-line Native** - lives in the terminal, no UI maze
- **Private by Default** - your business data stays on your machine
- **Familiar Workflow** - work like Git, context switch like branching! (`gig workspace client/project`)
- **Minimal Footprint** - single executable, no dependencies
- **Extendable** - create workflows, integrate with other systems, hackable

## Installation

```bash
# One command. Installs instantly.
curl -fsSL https://raw.githubusercontent.com/jubalm/gig/main/install.sh | sh
```

No sign-ups, no "onboarding," no credit card for the "trial."

## Core Commands

- `gig charge --message "what you did" --units hours` - Track work (quick mode)
- `gig charge` - Track work (opens `$EDITOR` like `git commit`)
- `gig workspace [name]` - Change client/project context
- `gig collect` - See unbilled work with totals and aggregates
- `gig collect workspace:client/* since:30d` - Advanced filtering with time ranges
- `gig mark ID collectible` - Ready for invoicing
- `gig collect --json` - Export data with aggregates for workflows

Advanced filtering (because sometimes you need to find that one thing):
```bash
gig collect workspace:startup/* since:30d
gig collect mark:collectible units:">3"
gig collect client:acme-corp units:"2-8"
```

Curious about the internals? See [technical architecture](docs/TECHNICAL.md) for the deep dive.

## Use Cases

**Generate invoices with calculated totals:**
```bash
gig collect workspace:acme-corp/* mark:collectible --json
```

The JSON includes everything you need for invoicing:

```json
{
  "aggregates": {
    "count": 3,
    "total_units": 12.5,
    "total_amount": 2187.50,
    "avg_units": 4.17,
    "workspaces": 2
  },
  "charges": [...]
}
```

**Track monthly earnings across all clients:**
```bash
gig collect since:30d --json | jq '.aggregates.total_amount'
```

For more advanced workflows and automation, see [Advanced Use Cases](docs/ADVANCED_USE_CASES.md).

## The Bottom Line

You've been living in the terminal. Now your business can too.

Start simple - track work, switch workspaces, bill clients. Then make it yours:

- Create [custom workspaces](docs/ADVANCED_USE_CASES.md#custom-context-patterns) that match your business: `@client/2025-q1/project` or `@startup/contract/phase-2`
- Add [Claude Code slash commands](docs/ADVANCED_USE_CASES.md#claude-code-integration) for natural language: `/gig which client owes me the most?`
- Build automation with simple bash scripts and git hooks
- Export to any system - it's just JSON

The CLI is the foundation. Your imagination is the limit.

```bash
curl -fsSL https://raw.githubusercontent.com/jubalm/gig/main/install.sh | sh
gig --help
```

That's it. Now go get paid.

---

*✊❤️ Built by and for terminal dwellers in dark mode, suffering from invoicing dashboard flashbang PTSD. 🫡🙏*

*Curious [where we're headed?](docs/VISION.md).*
