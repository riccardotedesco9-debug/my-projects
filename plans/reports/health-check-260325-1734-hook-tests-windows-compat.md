# Bug Report: Hook Test Suite — Windows Path Compatibility Failures

**Date:** 2026-03-25
**Reporter:** Riccardo Tedesco
**Severity:** Low (tests only — hooks function correctly in production)

## Environment

- **OS:** Windows 11 Pro 10.0.26200.0 (x86_64)
- **Shell:** Git Bash (MINGW64_NT 3.6.6)
- **Node.js:** v24.14.0
- **V8 Engine:** 13.6.233.17-node.41
- **Test Runner:** `node:test` built-in (Node 24)
- **npm:** 11.9.0
- **Git:** 2.53.0.windows.2
- **Claude Code:** 2.1.83
- **ClaudeKit:** Latest (installed via `install.ps1`, last modified 2026-03-25)
- **Developer Mode:** Not enabled (standard user — relevant to symlink EPERM)

## Summary

12 of 20 hook test files fail on Windows. All failures trace to Unix-path assumptions in test assertions. The hooks themselves work correctly in production — only the test harness is affected.

## Directory Structure

```
~/.claude/hooks/
├── health-check.cjs                    # Test runner (entry point)
├── __tests__/                          # Primary test suite
│   ├── ck-config-utils.test.cjs        ← FAIL (path separators)
│   ├── descriptive-name.test.cjs       ← FAIL (null hookSpecificOutput)
│   ├── dev-rules-reminder.test.cjs     ✓ PASS
│   ├── integration/
│   │   └── path-resolution.test.cjs    ✓ PASS
│   ├── privacy-block.test.cjs          ✓ PASS
│   ├── session-init.test.cjs           ← FAIL (ENOENT spawning node in temp dir)
│   ├── skill-dedup.test.cjs            ← FAIL (path separators)
│   ├── subagent-init.test.cjs          ← FAIL (symlink EPERM)
│   ├── task-completed-handler.test.cjs ← FAIL (progress count assertion)
│   ├── team-context-inject.test.cjs    ← FAIL (null vs expected output)
│   └── teammate-idle-handler.test.cjs  ← FAIL (task detection assertion)
├── lib/
│   ├── ck-config-utils.cjs             # Shared path utilities (root cause)
│   ├── colors.cjs
│   ├── config-counter.cjs
│   ├── context-builder.cjs
│   ├── git-info-cache.cjs
│   ├── hook-logger.cjs
│   ├── privacy-checker.cjs
│   ├── project-detector.cjs
│   ├── scout-checker.cjs
│   ├── transcript-parser.cjs
│   └── __tests__/
│       ├── ck-config-utils.test.cjs        ← FAIL (symlink EPERM)
│       ├── context-builder.test.cjs        ← FAIL (path resolution fallback)
│       ├── project-detector.test.cjs       ← FAIL (setup crash)
│       ├── statusline-integration.test.cjs ← FAIL (integration env issue)
│       └── statusline.test.cjs             ✓ PASS
├── tests/
│   └── scout-block/
│       ├── broad-pattern-detector.test.cjs ✓ PASS
│       ├── path-extractor.test.cjs         ✓ PASS
│       ├── pattern-matcher.test.cjs        ✓ PASS
│       └── scout-checker.test.cjs          ✓ PASS
├── scout-block/                        # Scout block module
│   ├── broad-pattern-detector.cjs
│   ├── error-formatter.cjs
│   ├── path-extractor.cjs
│   ├── pattern-matcher.cjs
│   └── vendor/ignore.cjs
├── notifications/                      # Notification providers
│   ├── notify.cjs
│   ├── providers/{discord,slack,telegram}.cjs
│   └── lib/{env-loader,sender}.cjs
├── clipboard-screenshot-hook.cjs       # Existing hooks (all present)
├── cook-after-plan-reminder.cjs
├── descriptive-name.cjs
├── dev-rules-reminder.cjs
├── post-edit-simplify-reminder.cjs
├── privacy-block.cjs
├── scout-block.cjs
├── session-init.cjs
├── skill-dedup.cjs
├── subagent-init.cjs
├── task-completed-handler.cjs
├── team-context-inject.cjs
├── teammate-idle-handler.cjs
├── usage-context-awareness.cjs
├── tts-response-hook.py
├── tts-response-player.py
├── tts-spacebar-interrupt.py
├── tts-spacebar-launcher.py
├── tts-stop-playback.py
├── approval-workflow.cjs               ← MISSING (referenced in settings.json)
├── brand-guidelines-reminder.cjs       ← MISSING (referenced in settings.json)
├── campaign-tracking.cjs               ← MISSING (referenced in settings.json)
├── write-compact-marker.cjs            ← MISSING (referenced in settings.json)
└── session-end.cjs                     ← MISSING (referenced in settings.json)
```

## Test Results

```
Hook Health Check: 20 test files

  [FAIL] __tests__/ck-config-utils.test.cjs          (443ms)
  [FAIL] __tests__/descriptive-name.test.cjs          (5850ms)
  [OK]   __tests__/dev-rules-reminder.test.cjs        (12365ms)
  [OK]   __tests__/integration/path-resolution.test.cjs (12286ms)
  [OK]   __tests__/privacy-block.test.cjs             (203ms)
  [FAIL] __tests__/session-init.test.cjs              (9416ms)
  [FAIL] __tests__/skill-dedup.test.cjs               (694ms)
  [FAIL] __tests__/subagent-init.test.cjs             (15547ms)
  [FAIL] __tests__/task-completed-handler.test.cjs    (10867ms)
  [FAIL] __tests__/team-context-inject.test.cjs       (12537ms)
  [FAIL] __tests__/teammate-idle-handler.test.cjs     (10860ms)
  [FAIL] lib/__tests__/ck-config-utils.test.cjs       (6216ms)
  [FAIL] lib/__tests__/context-builder.test.cjs       (914ms)
  [FAIL] lib/__tests__/project-detector.test.cjs      (150ms)
  [FAIL] lib/__tests__/statusline-integration.test.cjs (1505ms)
  [OK]   lib/__tests__/statusline.test.cjs            (253ms)
  [OK]   tests/scout-block/broad-pattern-detector.test.cjs (177ms)
  [OK]   tests/scout-block/path-extractor.test.cjs    (186ms)
  [OK]   tests/scout-block/pattern-matcher.test.cjs   (195ms)
  [OK]   tests/scout-block/scout-checker.test.cjs     (242ms)

8 passed, 12 failed (100906ms)
```

## Root Cause Analysis

Four distinct Windows-specific issues cause all 12 failures:

### 1. Path Separator Mismatch (affects 7+ tests)

Node.js `path.join()` on Windows returns backslash-separated paths. Test assertions hardcode Unix forward slashes.

**File:** `__tests__/skill-dedup.test.cjs:145`
```
Expected: '/local/.shadowed'
Actual:   '\local\.shadowed'
```

**File:** `__tests__/ck-config-utils.test.cjs` — `sanitizePath` suite
```
✖ allows normal relative paths
✖ allows paths within project
  → assertions check path.includes('/') which fails on Windows
```

**File:** `__tests__/ck-config-utils.test.cjs` — `getReportsPath` suite
```
✖ returns absolute path when baseDir provided
  → expected path uses '/' separators, actual uses '\'
```

This is the root cascade — `ck-config-utils.cjs` is imported by most hooks. When its path utilities return `\`-separated paths, downstream tests in `task-completed-handler`, `team-context-inject`, `teammate-idle-handler`, and `context-builder` also fail their assertions.

**Suggested fix:** Normalize paths in assertions using `path.normalize()` or compare with `path.sep`-aware matchers. Alternatively, use `path.posix.join()` in assertions that test logical path structure.

### 2. Symlink EPERM (affects 2 tests)

Windows requires admin privileges or Developer Mode enabled for `fs.symlinkSync()`. Standard user accounts get EPERM.

**File:** `__tests__/subagent-init.test.cjs`
```
Error: EPERM: operation not permitted, symlink
  path: 'C:\Users\Riccardo\AppData\Local\Temp\subagent-real-1774456037077'
  dest: 'C:\Users\Riccardo\AppData\Local\Temp\subagent-link-1774456037077'
```

**File:** `lib/__tests__/ck-config-utils.test.cjs`
```
Error: EPERM: operation not permitted, symlink
  'C:\Users\...\Temp\ck-test-real-1774456616166'
  -> 'C:\Users\...\Temp\ck-test-link-1774456616166'
```

Both tests crash entirely at the symlink setup step, marking the whole file as failed.

**Suggested fix:** Use `fs.symlinkSync(target, path, 'junction')` on Windows (junctions work without admin), or add platform guard: `if (process.platform === 'win32') test.skip()`.

### 3. Process Spawn ENOENT in Temp Dirs (affects 2 tests)

Tests that spawn `node` as a child process from temp directories fail with ENOENT on Windows.

**File:** `__tests__/session-init.test.cjs:256`
```
✖ shows subdirectory info when CWD differs from git root (Issue #327)
  Error: spawn node ENOENT
```

**File:** `__tests__/descriptive-name.test.cjs` — all hook output tests
```
TypeError: Cannot read properties of null (reading 'hookSpecificOutput')
  at descriptive-name.test.cjs:200:30
```
The hook returns null (spawn failed silently), then every assertion that reads `.hookSpecificOutput` throws TypeError.

**Suggested fix:** Ensure `node` is resolved via full path or `process.execPath` rather than relying on PATH resolution in temp directory contexts.

### 4. Env/Setup Cascade (affects 3 lib tests)

When the shared utility tests fail, lib-level integration tests that depend on them also fail:

**File:** `lib/__tests__/project-detector.test.cjs` — crashes at module level
```
✖ test failed (entire file, no individual test output)
```

**File:** `lib/__tests__/statusline-integration.test.cjs` — crashes at module level
```
✖ test failed (entire file, no individual test output)
```

**File:** `lib/__tests__/context-builder.test.cjs`
```
✖ falls back to workflows/ when rules/ does not exist
✖ disables usage section when usage-context-awareness: false
✖ disables both sections when both hooks false
  → path resolution returns Windows paths, assertions expect Unix paths
```

## Per-Test Failure Detail

| Test File | Failing Tests | Passing Tests | Root Cause |
|---|---|---|---|
| `__tests__/ck-config-utils.test.cjs` | 3 (sanitizePath ×2, getReportsPath ×1) | 60+ | Path separators |
| `__tests__/descriptive-name.test.cjs` | 10 (all output tests) | 1 (disable test) | Spawn ENOENT → null output |
| `__tests__/session-init.test.cjs` | 1 (subdirectory detection) | 13 | Spawn ENOENT in temp dir |
| `__tests__/skill-dedup.test.cjs` | 1 (resolvePaths) | 34 | Path separators |
| `__tests__/subagent-init.test.cjs` | 2 (absolute paths, symlink) | 14 | Symlink EPERM + path separators |
| `__tests__/task-completed-handler.test.cjs` | 2 (progress counts) | 8 | Output parsing / path cascade |
| `__tests__/team-context-inject.test.cjs` | 4 (JSON output, team detection, config, peers) | 5 | Null output from failed spawn |
| `__tests__/teammate-idle-handler.test.cjs` | 5 (all task detection) | 6 | Output parsing / path cascade |
| `lib/__tests__/ck-config-utils.test.cjs` | ALL (file-level crash) | 0 | Symlink EPERM |
| `lib/__tests__/context-builder.test.cjs` | 3 (rules fallback, hooks config) | 5 | Path separators |
| `lib/__tests__/project-detector.test.cjs` | ALL (file-level crash) | 0 | Setup failure (likely path) |
| `lib/__tests__/statusline-integration.test.cjs` | ALL (file-level crash) | 0 | Integration env setup |

## Additional Finding: 5 Missing Hook Files

These hooks are wired in `settings.json` but the corresponding `.cjs` files don't exist on disk:

| Hook File | Event | settings.json Location |
|---|---|---|
| `approval-workflow.cjs` | SubagentStart (all agents) | Line 89 |
| `brand-guidelines-reminder.cjs` | SubagentStart (content-creator, copywriter, etc.) | Line 98 |
| `campaign-tracking.cjs` | SubagentStart (campaign-manager, analytics, etc.) | Line 107 |
| `write-compact-marker.cjs` | PreCompact (manual\|auto) | Line 219 |
| `session-end.cjs` | SessionEnd (clear) | Line 241 |

All 5 fail silently at runtime (no errors, but intended behavior doesn't execute). Unclear if these are planned-but-unshipped, or if the install missed them.

## settings.json Hook Configuration (for reference)

The full hook wiring from `~/.claude/settings.json`:

```
SessionStart:     session-init.cjs, README.md auto-inject, tts-spacebar-launcher.py
SubagentStart:    subagent-init.cjs, team-context-inject.cjs, approval-workflow.cjs [MISSING]
                  brand-guidelines-reminder.cjs [MISSING] (marketing agents only)
                  campaign-tracking.cjs [MISSING] (campaign agents only)
SubagentStop:     cook-after-plan-reminder.cjs (Plan agent)
UserPromptSubmit: clipboard-screenshot-hook.cjs, tts-stop-playback.py,
                  dev-rules-reminder.cjs, usage-context-awareness.cjs
PreToolUse:       descriptive-name.cjs (Write), scout-block.cjs, privacy-block.cjs
PostToolUse:      post-edit-simplify-reminder.cjs, usage-context-awareness.cjs
TaskCompleted:    task-completed-handler.cjs
TeammateIdle:     teammate-idle-handler.cjs
PreCompact:       write-compact-marker.cjs [MISSING]
Stop:             tts-response-hook.py
SessionEnd:       session-end.cjs [MISSING]
```

## Impact

- **Production:** None. All existing hooks execute correctly in live sessions.
- **Testing:** Health check reports 60% failure rate on Windows, making it impossible to detect real regressions.
- **User experience:** Windows users running `node ~/.claude/hooks/health-check.cjs` see 12 failures that don't reflect actual system health.

## Reproduction

```bash
# On any Windows 11 machine with Node.js 24+ and ClaudeKit installed:
node ~/.claude/hooks/health-check.cjs --verbose
```

All 8 passing tests are either pure-logic tests (scout-block, statusline) or tests that already handle cross-platform paths (path-resolution integration, privacy-block).

## Requested Action

1. **Path assertions** — Normalize path comparisons in test assertions for cross-platform compat (`path.normalize()`, `path.sep`, or regex matchers)
2. **Symlink tests** — Use `'junction'` type on Windows or skip with platform guard
3. **Spawn in temp dirs** — Use `process.execPath` instead of bare `'node'` for child process spawns
4. **Missing hooks** — Clarify status of the 5 missing hook files (planned, deprecated, or install bug?)
