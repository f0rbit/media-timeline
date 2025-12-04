#!/bin/bash
set -e

echo "=== Media Timeline Local Setup ==="

# Check if wrangler is available
if ! command -v wrangler &> /dev/null; then
    echo "Installing wrangler..."
    bun add -g wrangler
fi

cd "$(dirname "$0")/.."

echo ""
echo "1. Running D1 migrations locally..."
wrangler d1 migrations apply media-timeline --local

echo ""
echo "2. Setting up encryption key..."
# Generate a random 32-char key if not set
if [ ! -f .dev.vars ]; then
    ENCRYPTION_KEY=$(openssl rand -hex 16)
    echo "ENCRYPTION_KEY=$ENCRYPTION_KEY" > .dev.vars
    echo "   Created .dev.vars with ENCRYPTION_KEY"
else
    echo "   .dev.vars already exists"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "To start local development:"
echo "  cd packages/worker"
echo "  wrangler dev"
echo ""
echo "The API will be available at http://localhost:8787"
echo ""
echo "To test the cron manually:"
echo "  curl http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
