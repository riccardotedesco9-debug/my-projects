# video-pipeline

Domain: Engineering

Local automation that drives **DaVinci Resolve (Studio)** via its scripting API, bridging the music **sourcing** side (Epidemic primary / Spotify `spotdl` personal / fal AI-fill + ffmpeg) with the "edit" side (Resolve). Started 2026-06-21.

## Division of labor (deterministic vs creative) — core rule
**AI is weak at taste/creativity/aesthetic nuance; strong at precise deterministic execution.** So this pipeline does ONLY the deterministic, non-interpretive parts and never makes aesthetic calls:
- **AI / scripts do:** beat detection + sync, cutting on beats, generating music/assets to a spec the user gives, exact transforms, render. Predictable, not open to interpretation.
- **Riccardo does:** all taste — which effects, transitions, zoom/look, vibe, which clip goes where, what's "good". Scripts must **never auto-apply** aesthetic choices (the beat-pulse zoom was removed for exactly this reason). When taste is needed, surface options / ask — don't default.

## How to drive Resolve (the WORKING method — learned the hard way)
- **Run scripts via Resolve's own runner, NOT external Python:**
  `& "C:\Program Files\Blackmagic Design\DaVinci Resolve\fuscript.exe" -l py3 <script.py>`
- Inside fuscript, the global **`bmd`** is injected → `resolve = bmd.scriptapp("Resolve")`. fuscript uses Resolve's **embedded Python 3.14**.
- ❌ **External Python (`import DaVinciResolveScript`) CRASHES** here — `0xC0000005` access violation loading `fusionscript.dll` on Resolve 21 (tried 3.10 and 3.11, both crash; env vars + DLL-dir didn't help). fuscript sidesteps it entirely. See memory `reference_resolve-scripting-fuscript`.
- **Resolve must be OPEN**, Studio, with `Preferences → System → General → External scripting using = Local`.
- Full API surface works via fuscript: media import, timelines, markers, Fusion, render/deliver. (Deep color-node edits + GUI plugins like BeatEdit are not API-drivable.)
- **Operational gotchas (learned 2026-06-21):**
  - A fresh boot's **"Untitled Project" is a stub — `ImportMedia`/`MediaStorage` return empty**. `ProjectManager.LoadProject("<name>")` a real project first, then import. (After a crash/battery loss, reopen the project before any media op.)
  - `CreateTimelineFromClips(name, …)` **fails silently on a name collision** — and fuscript may report exit 0 with no stdout. Use **unique timeline names** (timestamp) and verify via `GetTimelineByIndex`, don't trust the console.
  - fuscript's stdout has **no `.flush()`** (`fu_stdout`) — calling it raises; just `print()`.
  - **Place beat-cut segments by sequential `AppendToTimeline` (no `recordFrame`)** → contiguous, zero gaps. `recordFrame` IS honored for video, but pinning each segment leaves sub-frame gaps when clip-fps ≠ timeline-fps → **1-frame black flashes**. Sequential = no flash.

## Workflow — two lanes (verified by testing 2026-06-21)
**Flexible defaults, not a pipeline:** these lanes/modes are starting points — follow Riccardo's *live* request and adapt as the work goes; never force a fixed process or auto-impose structure. The input usually decides the lane; don't force the wrong one:
- **Finished/locked edit or limited footage → Mode 1 (Sonilo fits music to your cuts).** Gentle, accents land on the big cuts. You can't sync a finished edit to an arbitrary song without re-cutting — so **Mode 2 (your song under a locked edit) = background only, not sync.** Want your song synced → Mode 4 (re-cut to its beats).
- **Raw / varied footage → Mode 3/4 (cut to beats).** Punchy, on-beat.
- **`cuts ≤ distinct shots`:** music-first only reads as synced if the footage has ≥ as many distinct shots as beat-cuts (a 60s/~11-shot montage can't drive 63 cuts → invisible cuts). Use varied/long footage or widen `--every`.
- **Sync quality = BeatEdit, not the estimator.** BeatEdit tracks the song's real beat (drift/stutter) + you verify; `estimate_beats.py` is a rigid single-tempo no-click draft. The cutter imposes no grid — it cuts exactly where the markers are — so mark **musically in BeatEdit (only the beats you want) → `--every 1`** rather than blind `--every 2`.
- **Tweak after, in Resolve:** Slip (`T`, drag clip middle) = change the moment, keep it on-beat; drag the cut line = hold longer (off-beat on purpose). Normal clips; no re-import.
- **Grading & effects — RESOLVE-FIRST (verified 2026-06-22):** color/look → **Resolve via script**: `TimelineItem.SetCDL` (primary look), `SetLUT` (S-Log3→Rec709 + creative-look LUTs), `Timeline.ApplyGradeFromDRX` (saved grade) — grades the **whole clip**, stays editable on the color page, baked on render. Use **ffmpeg on the render only** for what Resolve's API can't keyframe: **timed/animated FX** (flash on a beat, fades, brighten one section, glow, transitions, Ken-Burns). **GUI-only** (set up + hand off like BeatEdit): color wheels/curves, Smart Reframe (AI vertical reframe), ResolveFX. Camera = **Sony a6700** (10-bit 4:2:2, HEVC ok in Studio+ffmpeg): shoot **S-Cinetone** for easy good-SOOC, or **S-Log3** for max grade latitude (needs a LUT/grade).

## Beat detection — BeatEdit (librosa dropped)
- **BeatEdit** (your 1 click in Resolve) is the chosen detector: editing-tuned (downbeats, subdivisions, beat selection, color-coding) with **visual verify + instant manual correction** — better than a blind librosa array. GUI-only / no API / no headless (verified: obfuscated 1.9 MB Lua, `UIManager` windows + `RequestFile` dialogs, no entry point — you cannot automate the click cleanly).
- Scripts **read** BeatEdit's markers via `Timeline.GetMarkers()` and automate from there.
- **librosa = DROPPED (2026-06-21):** BeatEdit is better and the single click is trivial; a second detector was redundant. (`resolve_beat_markers.py --from-json` stays as a generic "beats from any file" option, but nothing produces that file now.)

## Scripts (`scripts/`)
**FRONT DOOR — `sync.py`.** Routes the 4 music↔video modes on 2 axes: `--lead video|music` × `--music gen|track`. **Routing rule: video-first ⇒ footage LOCKED → fit music to it; music-first ⇒ footage RE-CUTTABLE → cut it to the song's beats.** Inputs = one or more files (concatenated for video-first; one-per-beat or jump-cut for music-first). Video-first is 1 step; music-first is 2 (BeatEdit's 1 click in the middle). See README for the command matrix. Plain `python`; gen needs `FAL_KEY`; Resolve paths need Resolve open.

**Music sourcing — where `--track` comes from (per root `CLAUDE.md` → Audio sourcing):** primary = **Epidemic Sound** (licensed, commercial; browse/drag via the Resolve plugin → file lands in the Resolve **project folder** → pass that path as `--track`). Personal/unlicensed = **Spotify** (`--track` accepts a Spotify URL/URI → auto-grabbed via `python -m spotdl`, preferred) or **YouTube** (`--track` accepts a YouTube URL → `python -m yt_dlp`, backup); grabbed to `.tmp/creative/`, lossy, personal-use only. `--music gen` / `--vocals` (fal Sonilo / Stable Audio / ElevenLabs-on-fal) = the **AI-generated *fill* lane** only — no longer the default.

**Video-first workhorse (called by sync.py; also usable directly):**
- `fit_music.py <video> --generate [--prompt]` — fal **Sonilo** scores your locked edit → Resolve timeline (or `--flat` MP4). ✅
- `fit_music.py <video> --track <audio> [--align]` — your song laid under; `--align` offsets it so its first hit lands on the footage's first cut (ffmpeg scene-detect + onset). Best-effort, not per-cut sync.
- `assemble_in_resolve.py` — import video + song → timeline (V1 + A1, **music aligned to the video start frame**). Used by the fit and BeatPrep paths.

**Music-first cut engine + Resolve API (run via fuscript):**
- `resolve_autocut.py` — read BeatEdit's markers on the current timeline → build a 'BeatCut' timeline whose footage **changes on every beat**: jump-cut the V1 clip (even-spread moments) OR `--clips a b …` (one per beat, cycling), `--every N` density; carries + head-trims the song so beat 1 = first cut. **Deterministic only — no auto-effects.**
- `resolve_render.py` — render a timeline to MP4 (H.264, **audio included** — `ExportAudio` forced) into `.tmp/creative/resolve-out/`.
- `resolve_connect_test.py` / `resolve_build_proof.py` / `resolve_beat_markers.py` — verify connection · full-control proof · read/write markers.

## Notes
- Python 3.10/3.11 + `RESOLVE_SCRIPT_API/LIB` env vars were installed during the failed external-Python attempts and are **NOT used** by the fuscript path. With librosa dropped, they're fully unused — **safe to uninstall** (cleanup pending).
