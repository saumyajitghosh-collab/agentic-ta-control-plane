#!/usr/bin/env bash
# Creates a PUBLIC GitHub repo from this folder, pushes it, and turns on GitHub Pages.
# Usage: ./scripts/push-to-github.sh [repo-name] [owner]
set -euo pipefail
REPO="${1:-agentic-ta-control-plane}"
OWNER="${2:-saumyajitghosh-collab}"
DESC="Manager-owned data, decisions and automation across every transfer agent. Agents propose, a deterministic policy decides."

cd "$(dirname "$0")/.."
if [ ! -d .git ]; then
  git init -b main
  git add .
  git commit -m "Agentic TA Control Plane: initial public release"
fi

if command -v gh >/dev/null 2>&1; then
  gh repo create "$OWNER/$REPO" --public --source . --push --description "$DESC"
  gh api -X POST "repos/$OWNER/$REPO/pages" -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1 \
    && echo "GitHub Pages enabled." \
    || echo "Enable Pages manually: Settings > Pages > Deploy from a branch > main / (root)."
  gh repo edit "$OWNER/$REPO" --add-topic transfer-agency --add-topic agentic-ai --add-topic asset-management --add-topic iso20022 --add-topic ai-governance >/dev/null 2>&1 || true
else
  echo "GitHub CLI not found; using plain git. Create an empty PUBLIC repo named $REPO on github.com first."
  git remote add origin "https://github.com/$OWNER/$REPO.git" 2>/dev/null || true
  git push -u origin main
  echo "Then enable Pages: Settings > Pages > Deploy from a branch > main / (root)."
fi
echo "Live site (after Pages builds): https://$OWNER.github.io/$REPO/"
