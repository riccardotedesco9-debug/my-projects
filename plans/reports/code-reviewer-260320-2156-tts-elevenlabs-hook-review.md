# Code Review: TTS System (ElevenLabs + ffplay)

## Scope
- **Files**: 4 (tts-response-hook.py, tts-response-player.py, tts-spacebar-interrupt.py, tts-stop-playback.py)
- **LOC**: ~275 combined
- **Focus**: Full system review -- correctness, races, edge cases, security, simplification
- **Supporting config**: settings.json hook registrations (Stop, SessionStart, UserPromptSubmit)

## Overall Assessment

Well-structured multi-process TTS pipeline. Clean separation of concerns: hook extracts text, player streams audio, interrupt listener handles spacebar, stop script handles prompt-submit kills. The file-based signaling pattern is pragmatic for cross-process coordination on Windows.

Several issues found, one critical (API key exposure), a few high-priority race conditions, and medium-priority edge cases in markdown stripping.

---

## CRITICAL Issues

### 1. API Key Hardcoded in settings.json (SECURITY)

**File**: `settings.json` line 197

```
"command": "ELEVENLABS_API_KEY=sk_58bb06af2b0d690966368c16797e4348b7ce9c5a2c42a8c7 ..."
```

The ElevenLabs API key is embedded as a plaintext inline environment variable in the hook command. This file is under `~/.claude/` which is not gitignored by default in all setups.

**Impact**: Key leakage if settings.json is ever committed, shared, backed up to cloud, or read by another process.

**Fix**: Store the key in a dedicated file (`~/.claude-tts/.env` or `~/.claude-tts/.api-key`) and have the player read it directly:

```python
# In tts-response-player.py
key_file = Path.home() / ".claude-tts" / ".api-key"
api_key = key_file.read_text().strip() if key_file.exists() else os.environ.get("ELEVENLABS_API_KEY", "")
```

Then remove the inline key from settings.json and use the plain python.exe invocation.

---

## HIGH Priority

### 2. Race: Stop Flag Cleared Too Early in Player (BUG)

**File**: `tts-response-player.py` lines 76-79 and 96-102

The player clears the stop flag at **two** points:
1. Line 77: `STOP_FLAG.unlink(missing_ok=True)` -- before calling ElevenLabs API
2. Line 97-102: Inside `_stream_to_ffplay` -- before starting ffplay

**Problem**: If the user presses spacebar (or submits a new prompt) *while the ElevenLabs API call is in-flight* (line 83-88), the stop flag gets set by the interrupt, but the player already cleared it on line 77. The flag check on line 97 will see nothing. Audio will play despite the interrupt.

**Timeline**:
```
Player clears flag (L77)  -->  API call starts (L83)  -->  User presses space  -->
Flag set by interrupt  -->  API returns  -->  _stream_to_ffplay checks flag (L97)
... but flag was set AFTER L77 clear, so this works.
```

Wait -- actually this specific race is handled correctly because the clear on L77 happens *before* the API call, and the interrupt sets the flag *during* the API call, so the check on L97 will see it. Good.

**However**, there IS a race between L77 and L97 if the spacebar interrupt fires *between* the clear on L77 and the `_stream_to_ffplay` entry:

```
Player clears flag (L77)  -->  User presses space  -->  Flag set  -->
_stream_to_ffplay checks flag (L97)  -->  Flag found, aborts  -->  OK
```

This also works. The real race is:

**Actual race**: Two player instances. If a new Stop event fires while a previous player is streaming, both run concurrently. Player 2 calls `_kill_existing_ffplay()` (L104) which kills Player 1's ffplay, but Player 1's loop may continue trying to write chunks to a dead pipe. This is handled by the `BrokenPipeError` catch -- so it degrades gracefully. **Low-risk in practice** since Stop events don't fire rapidly.

### 3. `_stream_to_ffplay` Does Not Check Stop Flag During Streaming (MISSED INTERRUPT)

**File**: `tts-response-player.py` lines 116-121

The streaming loop only checks `proc.poll()` -- whether ffplay died. It never re-checks `STOP_FLAG` during iteration. If the interrupt sets the flag but `taskkill` fails to kill ffplay (process not yet fully started, permission issue), the loop continues streaming all audio.

**Fix**: Check the flag periodically in the loop:

```python
for chunk in audio_iter:
    if proc.poll() is not None:
        break
    if STOP_FLAG.exists():
        proc.terminate()
        break
    proc.stdin.write(chunk)
    proc.stdin.flush()
```

### 4. Hardcoded FFPLAY Path (PORTABILITY / FRAGILITY)

**File**: `tts-response-player.py` line 23

```python
FFPLAY = Path(r"C:\Users\Riccardo\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1-full_build\bin\ffplay.exe")
```

This will break on any machine that isn't Riccardo's or after an FFmpeg update (version string in path).

**Fix**: Try `shutil.which("ffplay")` first, fall back to the hardcoded path:

```python
import shutil
FFPLAY = shutil.which("ffplay") or r"C:\Users\Riccardo\AppData\Local\..."
```

### 5. `ensure_packages()` Runs pip at Runtime (FRAGILE)

**File**: `tts-response-player.py` lines 26-36

Auto-installing `elevenlabs` via pip at runtime in a detached windowless process is risky:
- No user feedback if it fails
- Can corrupt the venv if two player instances trigger it simultaneously
- pip output is discarded (`capture_output=True`)
- After install, the import on line 69 may still fail if pip installed to wrong location

**Recommendation**: Remove `ensure_packages()`. Install `elevenlabs` during venv setup (presumably in an install script). If the package is missing, fail early with a clear message to stderr (even though it's /dev/null in production, helps during debugging).

---

## MEDIUM Priority

### 6. `strip_markdown` Edge Cases

**File**: `tts-response-hook.py` lines 26-65

Several gaps:

**(a) Nested/overlapping markdown not handled:**
- `***bold italic***` -- inner `*` remains after bold removal
- `**text with *inner* emphasis**` -- partially stripped

**(b) Strikethrough not handled:**
- `~~deleted text~~` passes through verbatim

**(c) Blockquotes not handled:**
- `> quoted text` keeps the `>` character, which sounds unnatural

**(d) HTML tags not stripped:**
- `<br>`, `<details>`, etc. pass through. Claude sometimes emits inline HTML.

**(e) Image syntax not handled:**
- `![alt text](url)` would produce `!alt text` after link regex (keeps the `!`)

**(f) Table pipes not cleaned:**
- `| Column | Data |` -- the `|` are in the technical symbols regex but the `---` separator rows remain

**(g) CLI flag regex is over-aggressive (line 57):**
```python
text = re.sub(r"\s--?\w[\w-]*", "", text)
```
This strips valid English like " --" from em-dashes or words starting with a hyphenated prefix after whitespace. Example: "it was -- frankly -- terrible" becomes "it was terrible". Also, the `\s` prefix means it consumes the leading whitespace, potentially collapsing words: "use -f flag" becomes "useflag".

**Fix for (g):** Require the flag to look more flag-like (after newline/sentence start or following a command-like context), or just leave them -- ElevenLabs handles dashes fine.

### 7. Spacebar Listener Never Exits (RESOURCE LEAK)

**File**: `tts-spacebar-interrupt.py` line 120-121

```python
with Listener(on_press=on_press, on_release=on_release) as listener:
    listener.join()
```

The listener runs forever until the process is killed. The startup hook kills the previous PID before spawning a new one, but:
- If Claude crashes without triggering SessionEnd, the listener process orphans
- The PID file write (line 116) has no locking -- two concurrent starts could race
- No periodic check of `VOICE_MODE_FLAG` -- if the user toggles voice mode off, the listener keeps running

**Fix**: Add a watchdog loop that checks voice mode periodically:

```python
while VOICE_MODE_FLAG.exists():
    time.sleep(10)
listener.stop()
```

### 8. `tts-stop-playback.py` Is Unreferenced

**File**: `tts-stop-playback.py`

This script is never called from settings.json. The `UserPromptSubmit` hook uses an inline `taskkill` command instead (line 101). The stop-playback script adds the STOP_FLAG touch, which the inline command does not.

**Impact**: If the user submits a new prompt while the ElevenLabs API call is in-flight (before ffplay starts), the inline `taskkill` kills nothing (ffplay isn't running yet), and no stop flag is set. The player will start playing audio from the *previous* response after the new prompt is already being processed.

**Fix**: Replace the inline taskkill in UserPromptSubmit with:

```json
"command": "\"$HOME/.claude-tts/Scripts/python.exe\" \"$HOME/.claude/hooks/tts-stop-playback.py\""
```

This is likely the most impactful bug in the system -- audio from a stale response plays over the new interaction.

### 9. Temp File Left Behind on Player Crash

**File**: `tts-response-hook.py` line 87-89, `tts-response-player.py` line 59

The hook writes a temp file; the player reads and deletes it (line 59). But if the player crashes between file read and unlink, or if the Popen fails silently, temp files accumulate in `%TEMP%`.

**Impact**: Low (OS cleans temp on reboot), but could be tidied by using `atexit` or `try/finally` in the player.

### 10. `_ffplay_is_running()` Is Expensive (PERFORMANCE)

**File**: `tts-spacebar-interrupt.py` line 33-40

Every spacebar hold triggers `tasklist` subprocess -- relatively heavy for a keyboard event handler. If the user holds space while typing normally and ffplay isn't running, this still spawns a process.

The cooldown (3s) mitigates repeated calls, but `_ffplay_is_running` is called inside `kill_ffplay` which is called from the timer callback, so there's no protection for the first call in a window.

**Minor optimization**: Cache the ffplay-running state with a short TTL, or check `/proc`-equivalent faster.

---

## LOW Priority

### 11. `creationflags` Constants

Mixed usage: `tts-spacebar-interrupt.py` defines `CREATE_NO_WINDOW = 0x08000000` as a named constant, while `tts-stop-playback.py` and `tts-response-player.py` use the raw hex `0x08000000` or `subprocess.CREATE_NO_WINDOW`. Be consistent -- prefer the `subprocess` module constant.

### 12. Silent Exception Swallowing

Every `except Exception: pass` is intentional (background process, no UI), but makes debugging impossible. Consider logging to a file in `~/.claude-tts/tts.log` with rotation, gated behind a DEBUG flag:

```python
DEBUG_LOG = Path.home() / ".claude-tts" / "debug.log"
def _log(msg):
    if DEBUG_LOG.parent.exists():
        with open(DEBUG_LOG, "a") as f:
            f.write(f"{time.time():.0f} {msg}\n")
```

### 13. Voice ID Hardcoded

`VOICE_ID = "DODLEQrClDo8wCz460ld"` in player. Could be configurable via `~/.claude-tts/config.json` or env var for flexibility.

---

## Positive Observations

- **Streaming architecture**: Piping ElevenLabs chunks directly to ffplay stdin is an excellent design -- minimizes time-to-first-audio
- **Spacebar hold vs tap discrimination**: The timer-based approach with `HOLD_THRESHOLD` is clever and prevents accidental interrupts during typing
- **Detached process model**: Using `pythonw.exe` + `CREATE_NO_WINDOW` + `CREATE_NEW_PROCESS_GROUP` ensures the TTS pipeline never blocks Claude's response flow
- **Graceful degradation**: Missing API key, missing voice mode flag, missing ffplay -- all fail silently without disrupting the main workflow
- **File-based IPC**: Simple, works across unrelated processes, no dependencies on named pipes or sockets

---

## Recommended Actions (Priority Order)

1. **[CRITICAL]** Move API key out of settings.json into `~/.claude-tts/.api-key`
2. **[HIGH]** Replace inline `taskkill` in UserPromptSubmit with `tts-stop-playback.py` to prevent stale audio (issue #8)
3. **[HIGH]** Add stop flag check inside the streaming loop (issue #3)
4. **[HIGH]** Make FFPLAY path discoverable via `shutil.which()` (issue #4)
5. **[MEDIUM]** Add voice-mode watchdog to spacebar listener (issue #7)
6. **[MEDIUM]** Fix image markdown (`![]()`) and blockquote stripping (issue #6)
7. **[MEDIUM]** Remove `ensure_packages()` -- install elevenlabs in venv setup (issue #5)
8. **[LOW]** Add optional debug logging (issue #12)
9. **[LOW]** Externalize voice ID to config (issue #13)

---

## Simplification Opportunities

1. **Merge tts-stop-playback.py into player**: The stop script is just `touch flag + taskkill`. This could be a function in the player invoked via `--stop` flag, reducing file count.
2. **Remove ensure_packages()**: 7 lines that cause more problems than they solve. One-time venv setup is sufficient.
3. **strip_markdown could use a library**: `markdownify` or a simple AST-based approach via `markdown-it-py` would handle all edge cases. Trade-off: adds a dependency.

---

## Unresolved Questions

1. What is `stop_hook_active` in the hook's input JSON? Is this a Claude Code internal field, or set by another hook? If another hook sets it, there may be ordering dependencies.
2. Is there a mechanism to restart the spacebar listener if it dies mid-session? Currently only startup/resume/clear events re-launch it.
3. Does `tts-response-hook.py` use `python.exe` (settings.json L197) while spawning the player with `pythonw.exe` (L19)? Intentional (hook needs stdin, player needs windowless), but worth documenting.
