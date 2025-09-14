#!/bin/sh
set -e

# Configuration
REPO="jubalm/gig"
DEFAULT_INSTALL_PATH="/usr/local/bin/gig"
USER_INSTALL_PATH="$HOME/.local/bin/gig"
BUNDLED_URL="https://raw.githubusercontent.com/$REPO/main/bin/gig.js"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
info() { echo "${GREEN}ℹ${NC} $1"; }
warn() { echo "${YELLOW}⚠${NC} $1"; }
error() { echo "${RED}✗${NC} $1" >&2; }
success() { echo "${GREEN}✅${NC} $1"; }

# Check for Node.js
if ! command -v node >/dev/null 2>&1; then
    error "Node.js is required but not installed."
    echo "Install Node.js from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node --version | sed 's/v//')
info "Found Node.js $NODE_VERSION"

# Determine install path
if [ -n "$INSTALL_PATH" ]; then
    CHOSEN_PATH="$INSTALL_PATH"
elif [ -w "$(dirname "$DEFAULT_INSTALL_PATH" 2>/dev/null || echo /usr/local/bin)" ] 2>/dev/null; then
    CHOSEN_PATH="$DEFAULT_INSTALL_PATH"
elif [ "$1" = "--user" ] || [ -n "$USER" ] && [ ! -w "$(dirname "$DEFAULT_INSTALL_PATH" 2>/dev/null || echo /usr/local/bin)" ] 2>/dev/null; then
    # Create ~/.local/bin if it doesn't exist
    mkdir -p "$(dirname "$USER_INSTALL_PATH")"
    CHOSEN_PATH="$USER_INSTALL_PATH"
else
    CHOSEN_PATH="$DEFAULT_INSTALL_PATH"
fi

# Determine if we need sudo
if [ -w "$(dirname "$CHOSEN_PATH" 2>/dev/null || dirname "$DEFAULT_INSTALL_PATH")" ] 2>/dev/null; then
    SUDO=""
else
    SUDO="sudo"
    warn "Installing to $CHOSEN_PATH (requires sudo)..."
fi

info "Downloading Gig CLI from GitHub..."

# Download the bundled script with error handling
if ! curl -fsSL "$BUNDLED_URL" -o /tmp/gig-installer; then
    error "Failed to download Gig CLI from GitHub"
    error "Please check your internet connection and try again"
    exit 1
fi

# Verify it's a valid Node.js script
if ! head -1 /tmp/gig-installer | grep -q "node"; then
    error "Downloaded file doesn't appear to be a valid Node.js script"
    exit 1
fi

# Make executable
chmod +x /tmp/gig-installer

# Test the script works
if ! /tmp/gig-installer --help >/dev/null 2>&1; then
    error "Downloaded script is not working correctly"
    exit 1
fi

info "Installing to $CHOSEN_PATH..."

# Install
if ! $SUDO mv /tmp/gig-installer "$CHOSEN_PATH"; then
    error "Failed to install to $CHOSEN_PATH"
    exit 1
fi

success "Gig CLI installed successfully!"

# Check if it's in PATH
if command -v gig >/dev/null 2>&1; then
    info "Run 'gig --help' to get started"
else
    warn "Note: $CHOSEN_PATH might not be in your PATH"
    if [ "$CHOSEN_PATH" = "$USER_INSTALL_PATH" ]; then
        warn "Add the following to your shell profile (.bashrc, .zshrc, etc.):"
        echo "export PATH=\"\$HOME/.local/bin:\$PATH\""
    fi
fi

# Show quick start
echo ""
echo "Quick start:"
echo "  gig --help          Show all commands"
echo "  gig context         Show current context"
echo "  gig switch -c work  Create and switch to 'work' context"
echo "  gig charge          Create a new charge (opens editor)"