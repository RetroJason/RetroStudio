#!/bin/bash
# update-version.sh
# Updates version.json with current git commit information

# Get current commit hash
COMMIT_HASH=$(git rev-parse HEAD)
SHORT_HASH=$(git rev-parse --short HEAD)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
BRANCH=$(git branch --show-current)

# Create version.json
cat > version.json << EOF
{
  "commit": "${COMMIT_HASH}",
  "shortCommit": "${SHORT_HASH}",
  "timestamp": "${TIMESTAMP}",
  "branch": "${BRANCH}",
  "version": "development"
}
EOF

echo "Updated version.json with commit ${SHORT_HASH}"
