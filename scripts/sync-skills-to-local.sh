#!/usr/bin/env bash
# Syncs a changed .claude/*.md skill file to C:\work\local\skills\ and pushes.
# Called by PostToolUse hook with the edited file path as $1.

FILE="$1"

# Only act on .claude/*.md files in this project
if [[ "$FILE" != *"tradingview-mcp-jackson/.claude/"* && "$FILE" != *"tradingview-mcp-jackson\\.claude\\"* ]]; then
  exit 0
fi

BASENAME=$(basename "$FILE")

# Must be a .md file
if [[ "$BASENAME" != *.md ]]; then
  exit 0
fi

LOCAL_SKILLS="/c/work/local/skills"

cp "$FILE" "$LOCAL_SKILLS/$BASENAME"

cd /c/work/local || exit 1

git add "skills/$BASENAME"

# Nothing to commit if file unchanged
if git diff --cached --quiet; then
  exit 0
fi

git commit -m "Sync $BASENAME from tradingview-mcp-jackson"
git push
