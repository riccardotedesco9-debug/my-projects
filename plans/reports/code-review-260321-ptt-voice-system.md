# Code Review: PTT Voice System (Push-to-Talk + TTS)

**Date:** 2026-03-21
**Reviewer:** code-reviewer
**Scope:** 5 Python scripts + SessionStart hook in settings.json
**Focus:** Restart reliability, thread safety, keyboard blocking leaks, stale state

---

## Overall Assessment

Solid architecture: clean separation between launcher, listener, hook, player, and stop scripts. File-based IPC (flag files) is appropriate for this cross-process coordination. However, there are **race conditions in keyboard block/unblock state** and **stale flag file issues** that can leave the spacebar permanently blocked or TTS permanently muted after crashes.

---

## Critical Issues

### C1. Spacebar permanently blocked after crash/kill (CRITICAL)

**File:** `tts-spacebar-interrupt.py` lines 206-213, 138-140, 248-250

If the process is killed (taskkill, session restart, crash) while `_space_blocked = True`, the `keyboard` library's low-level hook never calls `unblock_key("space")`. The keyboard hook is a Windows `SetWindowsHookEx` callback -- when the process dies, Windows removes the hook, but `keyboard.block_key()` works by suppressing the key event inside the hook callback. Once the process dies, the hook is removed and the key **is** unblocked by Windows automatically.

**Verdict:** NOT a real issue on Windows. Windows removes the hook on process exit. The block is only in-process. **No fix needed.**

### C2. Race condition: `_delayed_action` runs after release (HIGH)

**File:** `tts-spacebar-interrupt.py` lines 197-215, 236-257

Timeline:
1. User presses space at T=0
2. Timer fires `_delayed_action` at T=0.3 (on timer thread)
3. User releases space at T=0.31
4. `_on_space_release` runs on keyboard thread

If step 3 happens between `_delayed_action` setting `_space_blocked = True` (line 207) and starting recording (line 215), `_on_space_release` sees `_space_blocked=True, _recording=False` and unblocks (line 248-250). Then `_start_recording` begins on the timer thread at line 215, but the release already happened, so nobody will ever call `_stop_recording_and_transcribe`. Recording runs until MAX_RECORD_SECS timeout (30s) with space blocked status already cleared.

**Impact:** 30-second orphaned recording, no transcription output. Rare but possible on borderline holds.

**Fix:** Add a lock around the block/record/release transitions, or check `_recording` inside `_delayed_action` after `_start_recording` returns and handle the "already released" case.

### C3. Stale `.stop-playback` flag blocks all future TTS (HIGH)

**File:** `tts-response-player.py` lines 70-74, 98-103; `tts-stop-playback.py`

Current evidence: `.stop-playback` file exists right now on disk (size 0, dated 23:59). The player clears it at line 72, but there is a race:

1. `tts-stop-playback.py` creates `.stop-playback`
2. Player spawns, clears flag at line 72
3. Player reaches `_stream_to_ffplay`, checks flag at line 98 -- flag gone, proceeds normally

BUT if two Stop hooks fire in quick succession (multi-turn responses), or if the player crashes between clearing the flag and starting ffplay, the flag may linger. The SessionStart hook does NOT clear this flag on restart.

**Fix:** Add `rm -f "$HOME/.claude-tts/.stop-playback"` to the SessionStart hook command (line 67 of settings.json). Also consider a timestamp inside the flag file so the player can ignore stale flags older than N seconds.

---

## High Priority

### H1. No PID staleness check on restart (HIGH)

**File:** `settings.json` line 67; `tts-spacebar-interrupt.py` line 265

The SessionStart hook does:
```bash
cat .interrupt-listener.pid | xargs -r taskkill //F //PID 2>/dev/null
```

This kills the PID from file. But if the old process already died and the PID was reused by another Windows process, this kills an innocent process. PID reuse on Windows is common under high process churn.

**Fix:** Before killing, verify the process is actually `python.exe` running the expected script. Example:
```bash
PID=$(cat "$HOME/.claude-tts/.interrupt-listener.pid" 2>/dev/null)
if [ -n "$PID" ]; then
  tasklist //FI "PID eq $PID" //FI "IMAGENAME eq python.exe" //NH 2>/dev/null | grep -q python && taskkill //F //PID $PID 2>/dev/null
fi
```

### H2. Thread-unsafe globals without locking (HIGH)

**File:** `tts-spacebar-interrupt.py` -- all state variables lines 62-68

`_space_blocked`, `_recording`, `_pending_timer`, `_space_press_time`, `_last_action_time` are all accessed from multiple threads (keyboard hook thread, timer thread, recording thread) without any synchronization.

CPython's GIL protects against corruption of individual variable assignments, but compound check-then-act patterns are not atomic. For example in `_on_space_release`:
```python
if _space_blocked and not _recording:  # Thread A reads both
    keyboard.unblock_key("space")       # Thread B may set _recording=True between check and here
    _space_blocked = False
```

**Fix:** Add a `threading.Lock()` around all state transitions. Critical sections: `_delayed_action`, `_on_space_release`, `_start_recording`, `_stop_recording_and_transcribe`.

### H3. `tts-response-hook.py` uses pythonw.exe for player, but player uses CREATE_NO_WINDOW (MEDIUM-HIGH)

**File:** `tts-response-hook.py` line 19 vs `tts-response-player.py` line 113

The hook spawns the player with `pythonw.exe` (windowless) AND `CREATE_NO_WINDOW` flag. `pythonw.exe` already has no console. The `CREATE_NO_WINDOW` flag is fine but redundant. More importantly, `pythonw.exe` swallows all stderr -- if the player crashes, there is zero diagnostic output anywhere.

**Fix:** Consider logging errors to a file in `.claude-tts/player-errors.log` (rotating or truncating) so crashes are diagnosable. Or use `python.exe` + `CREATE_NO_WINDOW` instead of `pythonw.exe`.

---

## Medium Priority

### M1. `tts-launch-listener.py` is now dead code

**File:** `tts-launch-listener.py`

The SessionStart hook (settings.json line 67) launches `tts-spacebar-interrupt.py` directly with bash `&`. This launcher script uses `CREATE_NO_WINDOW` which, per the user's finding, kills keyboard hooks. It is no longer referenced from any hook.

**Fix:** Delete `tts-launch-listener.py` or add a comment marking it deprecated to avoid confusion.

### M2. `_ffplay_is_running()` shells out to `tasklist` on every hold (MEDIUM)

**File:** `tts-spacebar-interrupt.py` lines 71-77

Every spacebar hold >0.3s spawns a `tasklist` subprocess. On Windows, process creation is expensive (~50-100ms). This adds latency to the interrupt/PTT decision.

**Fix:** Use `ctypes` to call `EnumProcesses` or check a flag file (player could write a `.tts-playing` flag). Alternatively, accept the latency since it only fires on long holds.

### M3. Recording thread exception silently swallowed (MEDIUM)

**File:** `tts-spacebar-interrupt.py` lines 123-124

```python
except Exception:
    pass
```

If `sounddevice.InputStream` fails (device unplugged, permissions), the user gets zero feedback. Recording silently produces no frames, transcription is skipped.

**Fix:** At minimum, restore terminal title and unblock space in the except handler. Consider writing a one-line error to a log file.

### M4. `keyboard.write()` may fail with special characters (MEDIUM)

**File:** `tts-spacebar-interrupt.py` line 168

`keyboard.write(text)` simulates keystrokes. If the transcription contains characters not on the user's keyboard layout (accented chars, symbols), it may fail or produce wrong output.

**Fix:** Consider using `pyperclip` + `Ctrl+V` paste instead of `keyboard.write()` for reliability.

### M5. Temp file leak if player process never starts (MEDIUM)

**File:** `tts-response-hook.py` lines 139-156

If `subprocess.Popen` succeeds but the player crashes before reading the temp file (e.g., import error in `elevenlabs`), the temp file is never deleted.

**Fix:** Add a TTL-based cleanup. Either the player deletes on start (already does at line 50), or add a periodic cleanup of old `.txt` files in the temp directory.

---

## Low Priority

### L1. Hardcoded ffplay fallback path (LOW)

**File:** `tts-response-player.py` line 24

Path is specific to Riccardo's machine. Acceptable for personal use but will break on other setups.

### L2. `_original_title` saved as "Claude Code" hardcoded (LOW)

**File:** `tts-spacebar-interrupt.py` line 44

The real title is not retrieved; it is just assumed to be "Claude Code". Could use `ctypes.windll.kernel32.GetConsoleTitleW` to capture the actual title.

### L3. No graceful shutdown on SIGTERM/SIGINT (LOW)

**File:** `tts-spacebar-interrupt.py` lines 260-278

If killed with SIGTERM, `keyboard.unhook_all()` never runs. As noted in C1, Windows handles this, but a signal handler would allow clean PID file removal.

---

## SessionStart Hook Analysis (settings.json lines 62-71)

```bash
if [ -f "$HOME/.claude-tts/.voice-mode" ]; then
  cat "$HOME/.claude-tts/.interrupt-listener.pid" 2>/dev/null | xargs -r taskkill //F //PID 2>/dev/null;
  "$HOME/.claude-tts/Scripts/python.exe" "$HOME/.claude/hooks/tts-spacebar-interrupt.py" &
fi; exit 0
```

**Strengths:**
- Correctly uses `&` to background (inherits console for keyboard hooks)
- Kills previous instance before spawning new one
- `exit 0` ensures hook never blocks session start
- 3-second timeout is appropriate

**Issues:**
- PID reuse risk (H1 above)
- Does not clear `.stop-playback` flag (C3 above)
- `xargs -r` is a GNU extension; works in Git Bash but worth noting
- No verification that the python venv exists before launching

**Recommended improved command:**
```bash
if [ -f "$HOME/.claude-tts/.voice-mode" ]; then
  rm -f "$HOME/.claude-tts/.stop-playback";
  OLD_PID=$(cat "$HOME/.claude-tts/.interrupt-listener.pid" 2>/dev/null);
  [ -n "$OLD_PID" ] && tasklist //FI "PID eq $OLD_PID" //FI "IMAGENAME eq python.exe" //NH 2>/dev/null | grep -q python && taskkill //F //PID $OLD_PID 2>/dev/null;
  [ -x "$HOME/.claude-tts/Scripts/python.exe" ] && "$HOME/.claude-tts/Scripts/python.exe" "$HOME/.claude/hooks/tts-spacebar-interrupt.py" &
fi; exit 0
```

---

## Restart Reliability Summary

| Scenario | Survives? | Notes |
|---|---|---|
| Normal session restart (startup/resume) | Yes | SessionStart kills old + spawns new |
| Crash mid-recording | Mostly | Space unblocks (Windows), but `.stop-playback` may linger |
| Voice mode toggled off | Yes | Main loop exits, unhook_all runs |
| PID file stale + PID reused | Risk | May kill wrong process (H1) |
| `.stop-playback` left from previous crash | No | TTS silently skipped until manual cleanup (C3) |
| `clear` command | Yes | Matched by SessionStart hook |
| `compact` | No | Not in matcher -- listener not restarted. Acceptable since process persists. |

---

## Positive Observations

- Clean separation of concerns across 5 scripts
- Flag-file IPC is simple and debuggable
- Streaming TTS playback (pipe to ffplay stdin) is a good low-latency approach
- `strip_markdown()` is thorough and well-thought-out
- Short-tap passthrough (< 0.3s) is correct -- no interference with normal typing
- Daemon threads ensure no zombie processes on exit
- The decision to use bash `&` instead of `CREATE_NO_WINDOW` for keyboard hooks is correct

---

## Recommended Actions (Priority Order)

1. **Clear `.stop-playback` in SessionStart hook** -- one-line fix, prevents stale TTS muting (C3)
2. **Add threading.Lock to state transitions** in `tts-spacebar-interrupt.py` (H2, C2)
3. **Verify PID belongs to python.exe** before killing in SessionStart (H1)
4. **Add minimal error logging** to player and recording paths (H3, M3)
5. **Delete `tts-launch-listener.py`** or mark deprecated (M1)
6. **Consider clipboard paste** instead of `keyboard.write()` (M4)

---

## Unresolved Questions

1. Is `compact` intentionally excluded from the SessionStart matcher? The listener persists across compacts since it is a background process, but if the session crashes during compact the listener would be orphaned.
2. Should there be a maximum number of concurrent player processes? If multiple Stop hooks fire rapidly, multiple ffplay instances could overlap briefly despite `_kill_existing_ffplay()`.
3. The `COOLDOWN = 2.0` seconds prevents rapid re-triggering. Is this too aggressive? A user trying to interrupt TTS and then immediately start PTT would be blocked.
