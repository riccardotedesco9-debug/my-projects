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

# (optional) add markers from any beats.json (list of seconds)
& $fs -l py3 scripts\resolve_beat_markers.py --from-json beats.json

# auto-cut: slice the V1 clip onto a new 'AutoCut' timeline at the beats (+ optional beat-pulse zoom)
& $fs -l py3 scripts\resolve_autocut.py --zoom

# render a timeline (named or current) to MP4 -> .tmp/creative/resolve-out/
& $fs -l py3 scripts\resolve_render.py AutoCut
```

## Workflow it enables
1. Generate fitted music: fal Sonilo video-to-music + ffmpeg (`.tmp/creative/`).
2. In Resolve: drop the music, run **BeatEdit** (1 click) → beat markers.
3. Run a script here → reads the markers → automates assembly (next: auto-cut + render).

## Beat detection = BeatEdit (librosa dropped)
BeatEdit is editing-tuned + lets you visually verify/correct beats — better than a blind
detector, and the single click is trivial. It's GUI-only (can't be automated — verified), so
the one click stays; everything after it is scripted. librosa was dropped as redundant.
