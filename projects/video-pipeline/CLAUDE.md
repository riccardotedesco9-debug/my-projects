# video-pipeline

Domain: Engineering

Local automation that drives **DaVinci Resolve (Studio)** via its scripting API, bridging the "generate" side (fal music + ffmpeg) with the "edit" side (Resolve). Started 2026-06-21.

## How to drive Resolve (the WORKING method — learned the hard way)
- **Run scripts via Resolve's own runner, NOT external Python:**
  `& "C:\Program Files\Blackmagic Design\DaVinci Resolve\fuscript.exe" -l py3 <script.py>`
- Inside fuscript, the global **`bmd`** is injected → `resolve = bmd.scriptapp("Resolve")`. fuscript uses Resolve's **embedded Python 3.14**.
- ❌ **External Python (`import DaVinciResolveScript`) CRASHES** here — `0xC0000005` access violation loading `fusionscript.dll` on Resolve 21 (tried 3.10 and 3.11, both crash; env vars + DLL-dir didn't help). fuscript sidesteps it entirely. See memory `reference_resolve-scripting-fuscript`.
- **Resolve must be OPEN**, Studio, with `Preferences → System → General → External scripting using = Local`.
- Full API surface works via fuscript: media import, timelines, markers, Fusion, render/deliver. (Deep color-node edits + GUI plugins like BeatEdit are not API-drivable.)

## Beat detection
- **BeatEdit** (manual, 1 click in Resolve — GUI only) drops markers → scripts **read** them via the API (the hybrid).
- **No-click fallback:** an external **Python 3.10** (`C:\Program Files\Python310`) runs `librosa` to write a `beats.json` (seconds) → `resolve_beat_markers.py --from-json` adds them. (Two processes: 3.10 can't talk to Resolve directly, so it just computes beats; fuscript does the Resolve part.) librosa not installed yet.

## Scripts (`scripts/`) — all run via fuscript
- `resolve_connect_test.py` — verify connection (project/timeline/markers).
- `resolve_build_proof.py` — import clip+music → build timeline → add markers (full-control proof). ✅ verified.
- `resolve_beat_markers.py` — read markers (default) · `--demo-write` · `--from-json beats.json`.

## Notes
- Python 3.10/3.11 + `RESOLVE_SCRIPT_API/LIB` env vars were set during setup but are **NOT needed** for the fuscript path (kept; 3.10 is reused for the librosa no-click step).
