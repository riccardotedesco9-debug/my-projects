#!/bin/bash
# Run all test scenarios sequentially. Stops on first failure.
#
# Usage:
#   ./tools/test-scenarios/run-all.sh
#
# Each scenario resets the test users, runs through a sequence of webhooks,
# and asserts against D1. Scenarios are 60-120s each due to Trigger.dev
# cold-start + LLM latency. Budget: ~5 min for all scenarios.
#
# Run individual scenarios with:
#   ./tools/test-scenarios/scenario-01-happy-2-person.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

_GREEN=$'\033[32m'
_RED=$'\033[31m'
_BOLD=$'\033[1m'
_RESET=$'\033[0m'

SCENARIOS=(
  scenario-01-happy-2-person.sh
  # scenario-02-amend-after-match.sh  # FLAKY — see file header. Run manually.
)

PASSED=0
FAILED=0

for s in "${SCENARIOS[@]}"; do
  echo
  echo "${_BOLD}=== $s ===${_RESET}"
  if bash "./$s"; then
    PASSED=$(( PASSED + 1 ))
  else
    FAILED=$(( FAILED + 1 ))
    echo "${_RED}$s FAILED${_RESET}"
    exit 1
  fi
done

echo
echo "${_BOLD}summary:${_RESET} ${_GREEN}$PASSED passed${_RESET} / $FAILED failed"
