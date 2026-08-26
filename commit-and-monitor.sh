#!/bin/bash
set -euo pipefail

# Script to commit, push, and monitor GitHub Actions build
# Usage: ./commit-and-monitor.sh "Your commit message"

if [ -z "$1" ]; then
  echo "Usage: $0 \"commit message\""
  exit 1
fi

COMMIT_MSG="$1"

echo "=== Staging changes ==="
git add -A

if ! git diff --staged --quiet; then
  echo ""
  echo "=== Committing: $COMMIT_MSG ==="
  git commit -m "$COMMIT_MSG"
else
  echo "No staged changes to commit."
fi

echo ""
echo "=== Pushing to remote (with rebase) ==="
git pull --rebase origin main
git push origin main

echo ""
echo "=== Waiting for new run to appear ==="
sleep 15

LATEST_RUN=$(gh run list --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || echo "")

if [ -z "$LATEST_RUN" ]; then
  echo "Warning: Could not find latest run"
  exit 1
fi

echo "Monitoring run: $LATEST_RUN"
echo ""

# Poll the run status
MAX_WAIT=300  # 5 minutes
ELAPSED=0
INTERVAL=10

while [ $ELAPSED -lt $MAX_WAIT ]; do
  STATUS=$(gh run view "$LATEST_RUN" --json status --jq '.status' 2>/dev/null || echo "unknown")
  
  echo "[$(date '+%H:%M:%S')] Status: $STATUS (waited ${ELAPSED}s)"
  
  if [ "$STATUS" = "completed" ]; then
    conclusion=$(gh run view "$LATEST_RUN" --json conclusion --jq '.conclusion' 2>/dev/null || echo "unknown")
    echo ""
    echo "=== Run completed with conclusion: $conclusion ==="
    
    if [ "$conclusion" = "failure" ]; then
      echo ""
      echo "=== Build failed. Showing failed steps ==="
      gh run view "$LATEST_RUN" --log-failed 2>&1 | tail -200
      echo ""
      echo "=== FIX NEEDED ==="
      exit 1
    else
      echo ""
      echo "=== Build succeeded! ==="
      exit 0
    fi
  fi
  
  if [ "$STATUS" = "in_progress" ] || [ "$STATUS" = "queued" ] || [ "$STATUS" = "waiting" ]; then
    sleep $INTERVAL
    ELAPSED=$((ELAPSED + INTERVAL))
    continue
  fi
  
  echo "Unexpected status: $STATUS"
  exit 1
done

echo ""
echo "=== Timeout waiting for run to complete ==="
gh run view "$LATEST_RUN"
exit 1
