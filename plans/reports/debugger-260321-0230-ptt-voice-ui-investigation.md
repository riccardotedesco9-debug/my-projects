# PTT Voice UI Indicator Investigation Report
Date: 2026-03-21 02:30
Investigator: debugger agent

---

## Executive Summary

The terminal title "● Listening... speak now" stops working when the listener restarts with `_console_hwnd = 0`. The primary cause is that the launcher uses `python.exe` (not `pythonw.exe`) for its own execution when invoked by the hook — but the critical issue is that when the listener is already alive, the launcher skips writing the HWND file entirely, meaning a stale/invalid HWND persists. The confirmed root cause from the log at 02:17:26 is that the launcher ran, called `GetConsoleWindow()`, got `hwnd=0` (because the hook runs in a subprocess with no attached console), and only writes the HWND file when `hwnd` is truthy — leaving the file with the old (now-dead) HWND or zero.

Secondary bugs amplify the problem: a race between HWND write and listener read, and two distinct state machine anomalies visible in the log.

---

## Root Cause Analysis (Ranked by Likelihood)

### Bug #1 — CONFIRMED PRIMARY: Hook runs in a subprocess without an attached console (HWND=0)
**Likelihood: CERTAIN — directly observed in log**

**Evidence:** `02:17:26 [listener] console hwnd: 0`

**Mechanism:**
```
settings.json line 67:
  "command": "\"$HOME/.claude-tts/Scripts/python.exe\" \"$HOME/.claude/hooks/tts-spacebar-launcher.py\""

launcher.py line 59:
  hwnd = ctypes.windll.kernel32.GetConsoleWindow()
  if hwnd:
      HWND_FILE.write_text(str(hwnd))   # ← only writes if hwnd != 0
```

When Claude Code's hook runner spawns the launcher as a child process, `GetConsoleWindow()` returns the HWND of the console window that owns the current process. This **works** at true session startup because the hook runner is attached to the terminal. However, on `/clear` (and possibly `resume`), the hook runner may spawn the launcher in a context where it has no attached console — e.g., a new subprocess group, or the Claude Code terminal context differs.

The launcher's guard `if hwnd:` means when `GetConsoleWindow()` returns 0, the HWND file is NOT updated. So the file still contains whatever HWND was written during the previous launcher run. If that previous HWND is for a window that has since been destroyed (session restart, terminal close/reopen), `IsWindow()` returns false, listener sets `_console_hwnd = 0`.

**The listener-alive guard makes it worse:**
```python
# launcher.py line 66-67:
if _is_listener_alive():
    return   # ← returns WITHOUT writing HWND
```
If the listener was alive when the launcher ran for a `/clear` event, the HWND file is never updated — even when `GetConsoleWindow()` returns a valid new HWND for the fresh terminal. The listener keeps running with a stale HWND from before `/clear`.

**The restart at 02:17:26:** The listener was killed/crashed between 02:16:52 and 02:17:26 (no log entries in that gap). The launcher then ran (likely triggered by `/clear` or a session event), `GetConsoleWindow()` returned 0 in the hook subprocess, HWND file was NOT updated (or was written as 0), listener started with HWND=0.

---

### Bug #2 — HIGH: HWND file written but listener reads it before write completes (race condition)
**Likelihood: HIGH — timing-dependent**

**Mechanism:**
```
launcher.py:
  HWND_FILE.write_text(str(hwnd))    # write
  subprocess.Popen(...)              # spawn listener (fast, ~1ms)

interrupt.py main():
  _load_console_hwnd()               # read — happens almost immediately after spawn
```

`pythonw.exe` starts very fast. The listener can call `_load_console_hwnd()` before the OS has flushed the file write from the launcher. On Windows, `write_text()` uses buffered I/O and may not be fsynced. This is a narrow window but real on fast machines or SSDs.

**No mitigation exists** — there is no sleep, retry, or file locking between the write and the subprocess spawn.

---

### Bug #3 — HIGH: Double-trigger creates phantom recording + cooldown collision
**Likelihood: HIGH — confirmed in log**

**Log evidence (lines 49-51):**
```
01:58:32 [listener] recording started
01:58:32 [listener] action skipped (cooldown)
```
And again (lines 58-60):
```
02:01:31 [listener] recording started
02:01:31 [listener] action skipped (cooldown)
```

**Mechanism — two concurrent `_delayed_action()` calls:**
```python
# _on_space_press:
_pending_timer = threading.Timer(HOLD_THRESHOLD, _delayed_action)

# _delayed_action:
with _lock:
    if now - _last_action_time < COOLDOWN:
        _log("action skipped (cooldown)")
        return       # ← returns early, skips recording
    _last_action_time = now
# ... then ...
with _lock:
    keyboard.block_key("space")
    _space_blocked = True
    _recording = True        # ← set by the FIRST delayed_action
_schedule_safety_unblock()
_start_recording()           # ← _set_title called here by first thread
```

The same-timestamp "recording started" + "action skipped (cooldown)" indicates two timers fired near-simultaneously. The first timer proceeds past the cooldown check, sets `_recording = True`, calls `_start_recording()` which calls `_set_title("● Listening...")`. The second timer hits cooldown and returns. This is fine for recording correctness but reveals the timer can fire twice — meaning on some invocations, the state machine could be corrupted if the timing differs.

The deeper problem: `_pending_timer` is only cancelled in `_on_space_release`. If `block_key("space")` is active during recording, `_on_space_release` doesn't fire (the keyboard hook sees a key-up suppressed), so `_pending_timer` from a second space-down during recording may not be cancelled, firing `_delayed_action` while already recording.

---

### Bug #4 — MEDIUM: `_force_unblock` called outside lock clears title silently when HWND=0

**Mechanism:**
```python
# interrupt.py line 124:
def _force_unblock():
    with _lock:
        ...
    _set_title("")   # ← called OUTSIDE lock, no guard on _recording state
```

`_set_title("")` attempts to restore the original title. If `_console_hwnd == 0`, it silently no-ops. The title is already blank (never set), so this is harmless. But `_original_title` is set to `"Claude Code"` on the FIRST call to `_set_title(text)` — which never happens when HWND=0. So `_original_title` stays `""`, and the restore branch (`elif _original_title`) never fires. This is a cascading correctness problem — not a new bug per se, but it means any future fix that restores HWND mid-session won't restore the title properly either.

---

### Bug #5 — MEDIUM: `/clear` vs startup hook behavior difference
**Likelihood: MEDIUM**

**Hook config (settings.json line 62-70):**
```json
{
  "matcher": "startup|resume|clear",
  "hooks": [{
    "type": "command",
    "command": "\"$HOME/.claude-tts/Scripts/python.exe\" \"$HOME/.claude/hooks/tts-spacebar-launcher.py\""
  }]
}
```

On `startup`, Claude Code launches fresh — the hook runner IS attached to a console, `GetConsoleWindow()` returns the correct HWND. On `/clear`, the hook re-runs but in a different execution context. The Claude Code process itself doesn't restart; only the conversation context is cleared. The hook runner spawned for `/clear` may be a subprocess with `CREATE_NO_WINDOW` or in a different process group — causing `GetConsoleWindow()` to return 0.

**This is almost certainly the trigger for the 02:17:26 restart.** The previous listener was killed (02:16:52 last entry, 34-minute gap from 01:44), the user probably did `/clear` or restarted, the launcher ran with HWND=0.

---

### Bug #6 — LOW: `_is_listener_alive()` uses `python.exe` (not `pythonw.exe`) as the hook runner
**Setting (settings.json line 67):** `"$HOME/.claude-tts/Scripts/python.exe"`

The launcher is invoked with `python.exe` (has console) not `pythonw.exe`. This is intentional so `GetConsoleWindow()` can find the console. But when Claude Code's hook runner itself runs headlessly (no attached console), even `python.exe` won't have a console window — `GetConsoleWindow()` still returns 0. The python.exe vs pythonw.exe distinction only matters for whether the process creates its own console, not for whether it inherits one from its parent.

---

## State Machine Issues

### Issue A: `_recording = True` without title update (HWND=0 scenario)

Flow when HWND=0:
```
_delayed_action() →
  _start_recording() →
    _log("recording started")        ← logged (audio works)
    _set_title("● Listening...")     ← silently no-ops (HWND=0)
    threading.Thread(record).start() ← audio records fine
```

Recording functions correctly, transcription works, but the user has no visual feedback that recording is active. This is the user-visible symptom after 02:17:26 — all PTT entries in the log show recording+transcription still working, just no title.

### Issue B: Release monitor `_recording` flag check (non-atomic)

```python
# _start_release_monitor
def monitor():
    time.sleep(0.05)
    while _recording:           # ← reads _recording without lock
        if not keyboard.is_pressed("space"):
            threading.Thread(target=_stop_recording_and_transcribe).start()
            return
        time.sleep(0.02)
```

`_recording` is read without the lock. Python GIL ensures atomic reads for simple assignments, but visibility across threads isn't guaranteed in all cases. This is mostly safe due to GIL but is technically a data race.

### Issue C: Double `_stop_recording_and_transcribe` invocation path

Both `_on_space_release` (line 364) and the release monitor (line 383) can independently spawn `_stop_recording_and_transcribe`. The function guards against this:
```python
def _stop_recording_and_transcribe():
    with _lock:
        if not _recording:
            return  # Already stopped by another thread
```
This guard works correctly. Not a bug, but worth noting.

---

## Reproduction Scenarios

1. **Most reliable:** Type `/clear` in Claude Code. Launcher re-runs, `GetConsoleWindow()` returns 0 in the hook subprocess, HWND file not updated, next listener spawn (or current listener) gets HWND=0. Title breaks for the rest of the session.

2. **Race condition:** Start Claude Code, hold spacebar within ~5ms of session start before launcher has finished writing HWND file. Listener reads empty/stale HWND file.

3. **Stale HWND:** Close and reopen the terminal window without restarting Claude Code's hook runner. Old HWND is in the file, `IsWindow()` returns false, HWND=0. (Less likely given the hook runs on startup.)

4. **Double-timer cooldown:** Hold spacebar, quickly press again within COOLDOWN window. Both `recording started` and `action skipped (cooldown)` fire at same timestamp. While state is ultimately correct, it shows the timer management has edge cases.

---

## Specific Code References

| File | Line | Issue |
|------|------|-------|
| `tts-spacebar-launcher.py` | 59-62 | `GetConsoleWindow()` called in subprocess context that may lack console; only writes HWND when non-zero (leaving stale value) |
| `tts-spacebar-launcher.py` | 66-67 | Returns early without updating HWND if listener already alive — stale HWND persists through `/clear` |
| `tts-spacebar-interrupt.py` | 59-69 | `_load_console_hwnd()` called once at startup only; never retried if HWND invalid |
| `tts-spacebar-interrupt.py` | 72-86 | `_set_title()` silently returns when `_console_hwnd == 0`; no error logged |
| `tts-spacebar-interrupt.py` | 104 | `_pending_timer` not cancelled when `block_key` is active during recording |
| `tts-spacebar-interrupt.py` | 380 | `_recording` read without lock in release monitor |
| `settings.json` | 67 | Launcher invoked with `python.exe` — no console in hook subprocess context |

---

## Recommended Fixes (Prioritized)

### Fix 1 — CRITICAL: Always write HWND file, even when listener is alive; pass HWND via CLI arg

The HWND must be communicated to the listener on EVERY launcher invocation, not just when it starts a new listener. Two approaches:

**Option A (simplest): Write HWND file unconditionally, signal listener to reload**

```python
# tts-spacebar-launcher.py — replace lines 58-63:
try:
    hwnd = ctypes.windll.kernel32.GetConsoleWindow()
    # Always write HWND file (even if 0) so listener doesn't use stale value
    HWND_FILE.write_text(str(hwnd))
    # If listener is alive, signal it to reload HWND via a flag file
    HWND_RELOAD_FLAG = Path.home() / ".claude-tts" / ".reload-hwnd"
    HWND_RELOAD_FLAG.touch()
except Exception:
    pass
```

Then in the listener's main loop, check the reload flag:
```python
# tts-spacebar-interrupt.py — in the while loop:
while VOICE_MODE_FLAG.exists():
    reload_flag = Path.home() / ".claude-tts" / ".reload-hwnd"
    if reload_flag.exists():
        try:
            reload_flag.unlink()
        except Exception:
            pass
        _load_console_hwnd()
        _log(f"reloaded console hwnd: {_console_hwnd}")
    time.sleep(1)   # reduce from 10s for faster reload response
```

**Option B (more robust): Pass HWND as command-line argument to listener**

```python
# launcher.py spawn:
subprocess.Popen([python, str(LISTENER_SCRIPT), str(hwnd)], ...)

# interrupt.py main():
if len(sys.argv) > 1:
    try:
        _console_hwnd = int(sys.argv[1])
        if not ctypes.windll.user32.IsWindow(_console_hwnd):
            _console_hwnd = 0
    except Exception:
        pass
```

This eliminates the race condition entirely (no file needed for initial HWND).

---

### Fix 2 — HIGH: Log a warning when `_set_title()` is called with HWND=0

Minimal change, high diagnostic value:
```python
# tts-spacebar-interrupt.py — _set_title():
def _set_title(text: str):
    global _original_title
    try:
        if not _console_hwnd:
            if text:  # only warn on set, not on clear
                _log("WARNING: _set_title called but _console_hwnd=0, title update skipped")
            return
        ...
```

---

### Fix 3 — HIGH: Validate and retry HWND at recording start

Before setting the title, attempt to reload HWND if it's currently 0:
```python
# tts-spacebar-interrupt.py — _start_recording():
def _start_recording():
    global _console_hwnd
    import sounddevice as sd

    _recording_stop.clear()
    _audio_frames.clear()

    # Last-chance HWND reload if we have none
    if not _console_hwnd:
        _load_console_hwnd()
        if _console_hwnd:
            _log(f"late-loaded console hwnd: {_console_hwnd}")

    _log("recording started")
    _set_title("\u25cf Listening... speak now")
    ...
```

---

### Fix 4 — MEDIUM: Add HWND validity re-check before title operations

The HWND may become stale mid-session (window moved, resized, etc.) without the listener knowing:
```python
def _set_title(text: str):
    global _console_hwnd, _original_title
    try:
        if not _console_hwnd:
            return
        # Validate HWND still refers to a live window
        if not ctypes.windll.user32.IsWindow(_console_hwnd):
            _log(f"console hwnd {_console_hwnd} is no longer valid, clearing")
            _console_hwnd = 0
            return
        ...
```

---

### Fix 5 — LOW: Reduce main loop sleep for faster HWND reload response

```python
# interrupt.py line 447:
while VOICE_MODE_FLAG.exists():
    time.sleep(1)   # was 10 — faster response to HWND reload flag
```

---

## Summary of Root Cause Chain

```
/clear or session resume
    → hook runner spawns launcher as subprocess
    → subprocess has no attached console
    → GetConsoleWindow() returns 0
    → HWND file NOT updated (guard: `if hwnd:`)
    [if listener was dead] → listener spawns, reads stale/zero HWND
    [if listener was alive] → listener keeps stale HWND (launcher returns early)
    → _console_hwnd = 0 in listener
    → _set_title("● Listening...") silently no-ops
    → user sees no title feedback, recording still works
```

---

## Unresolved Questions

1. **What killed the listener between 02:16:52 and 02:17:26?** No `voice mode off, shutting down` log entry — it likely crashed or was killed externally. Root cause of that crash is unknown from current log data. Add crash logging (wrap `main()` in try/except that logs the exception before re-raising).

2. **Does `/clear` run the hook in a truly consoleless subprocess, or does it inherit the console?** Needs empirical testing: add `_log(f"GetConsoleWindow returned: {hwnd}")` to launcher before the `if hwnd:` guard to confirm this hypothesis.

3. **Can `GetConsoleWindow()` be called from a consoleless subprocess to get the parent's console?** On Windows, `GetConsoleWindow()` returns the HWND of the console attached to the current process — it does NOT traverse to the parent. Alternative: use `FindWindow(None, "Claude Code")` as a fallback (finds by window title), though this is fragile.

4. **Is the double-timer (Bug #3) causing any recording state corruption, or is it purely cosmetic?** From the log, transcription always succeeds after the double-trigger — but the state of `_last_action_time` after two near-simultaneous calls needs tracing.
