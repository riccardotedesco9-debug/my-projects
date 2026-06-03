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
  # Use locals so this function never shadows outer loop variables.
  local name="$1"
  local filter
  if (( ${#FILTERS[@]} == 0 )); then return 0; fi
  for filter in "${FILTERS[@]}"; do
    if [[ "$name" == *"agentic-$filter-"* || "$name" == "agentic-$filter.sh" ]]; then
      return 0
    fi
  done
  return 1
}

SCENARIOS=()
for file in agentic-*.sh; do
  [[ -e "$file" ]] || continue
  if matches_filter "$file"; then
    SCENARIOS+=("$file")
  fi
done

if (( ${#SCENARIOS[@]} == 0 )); then
  echo "${_DIM}(no matching scenarios)${_RESET}"
  exit 0
fi

# Reset the judge-skip counter before the run. _judge.sh increments it on
# every missing-ANTHROPIC_API_KEY skip. We check at the end — if any judge
# skipped, the suite result is unreliable regardless of pass count.
JUDGE_SKIP_COUNTER="${MEETSYNC_TEST_JUDGE_SKIP_COUNTER:-/c/tmp/meetsync-judge-skips.count}"
echo 0 > "$JUDGE_SKIP_COUNTER"

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

SKIPPED_JUDGES=0
[[ -f "$JUDGE_SKIP_COUNTER" ]] && SKIPPED_JUDGES=$(cat "$JUDGE_SKIP_COUNTER" 2>/dev/null || echo 0)

echo
echo "${_BOLD}summary:${_RESET} ${_GREEN}$PASSED passed${_RESET} / ${_RED}$FAILED failed${_RESET} (${#SCENARIOS[@]} total)"

if (( FAILED > 0 )); then
  echo "failed scenarios:"
  for n in "${FAILED_NAMES[@]}"; do
    echo "  - $n"
  done
  exit 1
fi

# Pass count is green but judges skipped — many scenarios have only judge
# assertions. Without the key, those scenarios report green while testing
# nothing substantive. Flag that loudly; exit 2 so run-all.sh in CI doesn't
# read this as clean.
if (( SKIPPED_JUDGES > 0 )); then
  echo
  echo "${_RED}UNRELIABLE:${_RESET} $SKIPPED_JUDGES judge assertion(s) were skipped — ANTHROPIC_API_KEY missing."
  echo "${_DIM}Pass count reflects only the D1-outcome assertions; judge semantic checks did NOT run."
  echo "${_DIM}Add ANTHROPIC_API_KEY to meetsync/.env.test (or .env) and rerun for a real result.${_RESET}"
  exit 2
fi
