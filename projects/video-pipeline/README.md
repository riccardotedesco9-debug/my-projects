# video-pipeline

Sync music and video across **4 directions**, driving DaVinci Resolve (Studio). Music comes from
**Epidemic Sound** (licensed, primary), **Spotify** via `spotdl` (personal), or **fal** AI-fill; ffmpeg
muxes. One front door: **`sync.py`**. Deterministic execution; you bring the taste.

## The one tool — `sync.py`
Two axes pick the mode: **--lead** (who leads) × **--music** (whose music).

| | `--music gen` (AI) | `--music track` (your song) |
|---|---|---|
| **`--lead video`** (footage locked → fit music to it) | **1** Sonilo scores your edit | **2** lay your song under + downbeat-align |
| **`--lead music`** (footage re-cuttable → cut to beats) | **3** generate a song → cut footage to it | **4** your song → cut footage to it |

**Routing rule:** *video-first* never re-cuts your edit; *music-first* cuts the footage to the song's beats (so something visibly changes on every beat = real, felt sync).

### Video-first (1 step) — Resolve must be open (or `--flat` for a quick MP4)
```
# mode 1 — AI scores your locked edit (Sonilo)
python scripts\sync.py "edit.mp4" --lead video --music gen --prompt "dark gothic synthwave"

# mode 2 — your own song, laid under + first-hit aligned to the first cut
python scripts\sync.py "edit.mp4" --lead video --music track --track "song.mp3"

# multiple clips are concatenated first; add --flat to skip Resolve
python scripts\sync.py a.mp4 b.mp4 c.mp4 --lead video --music gen --flat
```

### Music-first (2 steps — BeatEdit's 1 click sits in the middle)
```
# step 1 — get the song onto a Resolve 'BeatPrep' timeline
python scripts\sync.py a.mp4 b.mp4 --lead music --music gen --prompt "fast darkwave, high guitar" --length 60
python scripts\sync.py a.mp4 b.mp4 --lead music --music track --track "song.mp3"

#   ↳ then in Resolve: select 'BeatPrep', run BeatEdit on the song (1 click) → beat markers

# step 2 — cut the footage to those beats (modes 3 & 4)
python scripts\sync.py a.mp4 b.mp4 --lead music --cut --every 1
```
- **Multiple clips** → one clip per beat, in your order (cycles if fewer clips than beats).
- **One file** → jump-cut: each beat jumps to a different, evenly-spread moment of it.
- `--every N` = use every Nth beat (density). `--vocals` (gen) = ElevenLabs-on-fal instead of instrumental.
- No-click draft: add `--auto-beats` to skip BeatEdit (auto-detects a steady tempo — rigid, less accurate; BeatEdit stays the real-sync path).
- **`--track` source:** local file, a **Spotify** URL/URI (auto-grabbed via `spotdl`, preferred), or a **YouTube** URL (`yt-dlp`, backup) → grabbed to `.tmp/creative/` (lossy, personal-use only). **Licensed Epidemic** tracks: drag via the Resolve plugin, then pass the project-folder file path as `--track`.

### Which lane to use (verified by testing 2026-06-21)
Two real lanes — the input decides:
- **Finished/locked edit (or limited footage)** → **Mode 1** (Sonilo fits music to *your* cuts). Gentle, accents land on the big cuts. The right tool for a montage you love.
- **Raw / varied footage, want fast & punchy** → **Mode 3/4** (cut to the beats). Needs enough footage variety (see rule below).
- **Mode 2** (your song under a locked edit) = background music, **not sync**. You can't sync a finished edit to an arbitrary song without re-cutting it — if you want your song *synced*, use Mode 4.

### Getting sync that actually reads
- **Cuts ≤ distinct shots.** Music-first only *looks* synced if the footage has at least as many distinct shots as beat-cuts. A 60s montage with ~11 shots can't drive 63 cuts — most land in the same shot → invisible. Use long/varied footage, or widen `--every`.
- **Mark musically in BeatEdit, then `--every 1`.** Don't blind-cut `--every 2` (lands on weak beats / mid-fill = jarring). In BeatEdit, mark **only the beats you want to cut on** (downbeats, the drop, the phrasing) → cut every marker. BeatEdit follows the song's real beat incl. drift/stutter; the cutter just places a cut at each marker (no grid of its own), so feel is preserved.

### Tweaking the result in Resolve (no re-import, no re-run)
The BeatCut is normal clips on V1 with the beat markers on the ruler.
- **Bad moment, keep it on beat → Slip:** press `T`, drag the *middle* of the clip (changes footage shown, cut stays on the beat). `A` returns to the arrow.
- **Hold a shot longer → drag the cut line** (comes off the strict beat on purpose).

### Color grading (Resolve-first)
Grading/looks are done **in Resolve via script** — `SetCDL` (a primary look), `SetLUT` (Sony S-Log3→Rec709 conversion or a creative LUT), `ApplyGradeFromDRX` (a saved grade). It grades the whole clip and **stays editable** on the color page. ffmpeg is used only for **timed/animated FX** the Resolve API can't keyframe (a flash on a beat, fades, brightening one section, glow). Camera tip (a6700): shoot **S-Cinetone** for good-out-of-camera + light grade, or **S-Log3** for maximum grading control (needs a LUT/grade applied).

---

## Under the hood — Resolve via `fuscript`, not external Python
External Python crashes loading Resolve 21's bridge DLL. Resolve's own runner works:
```
& "C:\Program Files\Blackmagic Design\DaVinci Resolve\fuscript.exe" -l py3 <script>
```
Inside, `bmd.scriptapp("Resolve")` connects. **Resolve must be OPEN** (Studio, External scripting = Local).

`sync.py` orchestrates these (you rarely call them directly):
- `fit_music.py` — video-first: Sonilo `--generate` / your `--track` (+ `--align`), → Resolve timeline or `--flat` MP4.
- `assemble_in_resolve.py` — import video + song → timeline (V1 + A1 aligned). Used for `--flat`-less fit and BeatPrep.
- `resolve_autocut.py` — music-first cut engine: read BeatEdit markers → jump-cut a file / cycle `--clips`, `--every N`, carry+trim the song so beat 1 = first cut.
- `resolve_render.py` — render a timeline to H.264 MP4 (audio included) → `.tmp/creative/resolve-out/`.
- `resolve_beat_markers.py` / `resolve_connect_test.py` / `resolve_build_proof.py` — read markers / verify / full-control proof.

## Beat detection = BeatEdit (librosa dropped)
BeatEdit is editing-tuned and lets you visually verify/correct beats — better than a blind
detector, and the single click is trivial. GUI-only (can't be automated — verified), so the
one click stays; everything after it is scripted (`Timeline.GetMarkers()`).
