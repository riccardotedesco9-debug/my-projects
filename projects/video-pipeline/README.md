# video-pipeline

Drive DaVinci Resolve (Studio) from scripts + bridge the fal music / ffmpeg flow.

## The one rule: run scripts via `fuscript`, not python
External Python crashes loading Resolve 21's bridge DLL. Resolve's own runner works:
```
& "C:\Program Files\Blackmagic Design\DaVinci Resolve\fuscript.exe" -l py3 <script>
```
Inside, `bmd.scriptapp("Resolve")` connects. **Resolve must be OPEN** (Studio, External scripting = Local).

## Run
```
$fs = "C:\Program Files\Blackmagic Design\DaVinci Resolve\fuscript.exe"

# verify connection
& $fs -l py3 scripts\resolve_connect_test.py

# full-control proof: import clip+music, build timeline, add markers
& $fs -l py3 scripts\resolve_build_proof.py

# read current timeline markers (e.g. BeatEdit's)
& $fs -l py3 scripts\resolve_beat_markers.py

# add markers from a librosa-generated beats.json (no-click bridge)
& $fs -l py3 scripts\resolve_beat_markers.py --from-json beats.json
```

## Workflow it enables
1. Generate fitted music: fal Sonilo video-to-music + ffmpeg (`.tmp/creative/`).
2. In Resolve: drop the music, run **BeatEdit** (1 click) → beat markers — OR run librosa externally → `--from-json`.
3. Run a script here → reads the markers → automates assembly (future: auto-cut + render).

## No-click beats (optional, later)
`& "C:\Program Files\Python310\python.exe" -m pip install librosa soundfile`, then a small
helper detects beats → writes `beats.json` → `resolve_beat_markers.py --from-json`.
(librosa runs in 3.10 because Resolve's embedded interp has no pip; fuscript does the Resolve side.)
```
