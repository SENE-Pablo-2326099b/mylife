#!/bin/bash
# Préparation d'une session Claude Code dans le cloud (claude.ai/code) : dépendances de l'accueil et des trois apps,
# et un Chrome pour les parcours de bout en bout (absent des machines du cloud). Lancé par le hook SessionStart
# (.claude/settings.json) ; ne fait rien en local. Rapide quand tout est déjà là (empreintes des package-lock).
# Peut aussi servir de « setup script » de l'environnement cloud (mis en cache) : `bash scripts/cloud-setup.sh --force`.

if [ "$CLAUDE_CODE_REMOTE" != "true" ] && [ "$1" != "--force" ]; then
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT" || exit 1
LOG="$ROOT/node_modules/.cloud-setup.log"
mkdir -p node_modules

# Dépendances d'un dossier, réinstallées seulement si son package-lock a changé.
install() {
  local dir="$1"
  local mark="$dir/node_modules/.cloud-setup.sha256"
  if sha256sum --check --status "$mark" 2>/dev/null; then return 0; fi
  rm -f "$mark"
  if (cd "$dir" && npm ci --no-audit --no-fund --loglevel=error); then
    sha256sum "$dir/package.json" "$dir/package-lock.json" > "$mark"
  else
    echo "npm ci a échoué dans $dir" >&2
    return 1
  fi
}

# Chrome for Testing (storage.googleapis.com, autorisé par défaut) et ses bibliothèques (dépôts Ubuntu), relié à
# /usr/bin/google-chrome : le chemin qu'attendent les tests de bout en bout (sinon CHROME_PATH).
chrome() {
  if [ -x /usr/bin/google-chrome ]; then return 0; fi
  export DEBIAN_FRONTEND=noninteractive
  (apt-get update -qq && apt-get install -y -qq --no-install-recommends \
    libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libcups2t64 libdrm2 libgbm1 libgtk-3-0t64 libnss3 \
    libxcomposite1 libxdamage1 libxfixes3 libxkbcommon0 libxrandr2 libxshmfence1 libpango-1.0-0 libcairo2 \
    fonts-liberation fonts-noto-color-emoji) > /dev/null 2>&1 || echo "Bibliothèques de Chrome : installation incomplète" >&2
  local dest="$HOME/.cache/chrome-for-testing"
  local bin
  bin=$(npx --yes @puppeteer/browsers@2.10.5 install chrome@stable --path "$dest" 2>/dev/null | tail -1 | awk '{print $2}')
  if [ -n "$bin" ] && [ -x "$bin" ]; then
    ln -sf "$bin" /usr/bin/google-chrome
  else
    echo "Chrome n'a pas pu être installé : les parcours de bout en bout ne tourneront pas." >&2
    return 1
  fi
}

{
  echo "== $(date -u +%FT%TZ) préparation"
  install . &
  install apps/finances &
  install apps/raveloc &
  install apps/perf &
  chrome &
  wait
  echo "== $(date -u +%FT%TZ) terminé"
} >> "$LOG" 2>&1

# Ce qui a mal tourné remonte dans la session (le reste est dans le journal).
grep -E "échoué|incomplète|pas pu" "$LOG" | tail -5
exit 0
