#!/bin/bash
# Run every agentic-era scenario sequentially. Continues through failures,
# reports a tally at the end. Exits non-zero if any scenario failed.
#
# Usage:
#   ./tools/test-scenarios/run-all.sh              # every scenario
#   ./tools/test-scenarios/run-all.sh L1           # only L1 (regression)
#   ./tools/test-scenarios/run-all.sh L1 L2        # L1 + L2
#
# Scenarios auto-discovered by glob: agentic-LN-*.sh. A full run is ~5-10 min
# (each scenario costs Trigger.dev cold-start + one or more Sonnet turns).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

_GREEN=$'\033[32m'
_RED=$'\033[31m'
_BOLD=$'\033[1m'
_DIM=$'\033[2m'
_RESET=$'\033[0m'

# If filters were passed (L1, L2, ...) only run those. No filter → run all.
FILTERS=("$@")

matches_filter() {
  local name="$1"
  if (( ${#FILTERS[@]} == 0 )); then return 0; fi
  for f in "${FILTERS[@]}"; do
    if [[ "$name" == *"agentic-$f-"* || "$name" == "agentic-$f.sh" ]]; then
      return 0
    fi
  done
  return 1
}

SCENARIOS=()
for f in agentic-*.sh; do
  [[ -e "$f" ]] || continue
  if matches_filter "$f"; then
    SCENARIOS+=("$f")
  fi
done

if (( ${#SCENARIOS[@]} == 0 )); then
  echo "${_DIM}(no matching scenarios)${_RESET}"
  exit 0
fi

PASSED=0
FAILED=0
FAILED_NAMES=()

for s in "${SCENARIOS[@]}"; do
  echo
  echo "${_BOLD}=== $s ===${_RESET}"
  if bash "./$s"; then
    PASSED=$(( PASSED + 1 ))
  else
    FAILED=$(( FAILED + 1 ))
    FAILED_NAMES+=("$s")
    echo "${_RED}$s FAILED${_RESET}"
  fi
done

echo
echo "${_BOLD}summary:${_RESET} ${_GREEN}$PASSED passed${_RESET} / ${_RED}$FAILED failed${_RESET} (${#SCENARIOS[@]} total)"

if (( FAILED > 0 )); then
  echo "failed scenarios:"
  for n in "${FAILED_NAMES[@]}"; do
    echo "  - $n"
  done
  exit 1
fi
