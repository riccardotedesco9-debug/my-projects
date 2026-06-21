"""Cut footage to the beat (music-first). Reads the beat markers on the CURRENT timeline
(BeatEdit's, dropped on the song), then builds a new 'BeatCut' timeline whose footage
visibly CHANGES on every beat + carries the song aligned so beat 1 lands on the first cut.

RUN VIA fuscript:
    & "C:\\Program Files\\Blackmagic Design\\DaVinci Resolve\\fuscript.exe" -l py3 resolve_autocut.py [opts]

Sources (deterministic placement; WHICH footage/order is your taste):
    (default)             jump-cut the current timeline's V1 clip -> a different, evenly
                          spread moment of it per beat (visible cuts from one file).
    --clips a.mp4 b.mp4   one clip per beat, cycling through the list in the order given.
    --every N             use every Nth beat (density knob); default 1.

Segments are appended back-to-back (contiguous -> no black-flash gaps); each segment's length
is its beat gap, so cuts land on the beats. (A --clips clip shorter than its beat adds slight
drift after it -- it warns; use longer clips or a larger --every.)
Prereq: Resolve open; current timeline has the song on A1 + beat markers (run BeatEdit first),
and either a video clip on V1 (jump-cut) or --clips supplied.
Deterministic only -- NO auto-effects. Look/transitions/which-clip-where are yours to add.
"""
import sys
import time

try:
    resolve = bmd.scriptapp("Resolve")  # noqa: F821  (injected by fuscript)
except NameError:
    sys.exit("run via fuscript.exe -l py3")
if not resolve:
    sys.exit("Resolve not open")

argv = sys.argv[1:]
every = 1
clip_paths = []
if "--every" in argv:
    i = argv.index("--every")
    try:
        every = max(1, int(argv[i + 1]))
    except (IndexError, ValueError):
        sys.exit("--every needs a positive integer")
if "--clips" in argv:
    clip_paths = [a for a in argv[argv.index("--clips") + 1:] if not a.startswith("--")]
    if not clip_paths:
        sys.exit("--clips needs at least one file path")

proj = resolve.GetProjectManager().GetCurrentProject()
if not proj:
    sys.exit("no project open")
mp = proj.GetMediaPool()
src = proj.GetCurrentTimeline()
if not src:
    sys.exit("no current timeline")
fps = float(src.GetSetting("timelineFrameRate") or 30)


def clip_frames(item, fallback):
    """Source length in frames; fresh imports can read 0 before analysis -> use fallback then."""
    try:
        n = int(item.GetClipProperty("Frames"))
    except (TypeError, ValueError):
        return fallback
    return n if n > 0 else fallback


def clip_fps(item):
    try:
        return float(item.GetClipProperty("FPS"))
    except (TypeError, ValueError):
        return fps


markers = src.GetMarkers() or {}
beat_frames = sorted(markers)[::every]          # downsample for density
if len(beat_frames) < 2:
    sys.exit(f"need >=2 beat markers (have {len(beat_frames)} after --every {every}) -- run BeatEdit on the song first.")
base = beat_frames[0] / fps                      # song intro before beat 1 (seconds)
nb = [f / fps - base for f in beat_frames]       # normalize: beat 1 -> 0 (first cut)
n_seg = len(nb) - 1
print(f"{len(beat_frames)} beats -> {n_seg} segments (every={every}, song intro {base:.2f}s)")

# Capture the source timeline's A1 (song) + V1 (jump-cut source) BEFORE switching timelines.
src_audio = src.GetItemListInTrack("audio", 1) or []
src_v1 = src.GetItemListInTrack("video", 1) or []

# New timeline to build onto; its start frame anchors the carried song.
tl_name = "BeatCut_%d" % int(time.time())
newtl = mp.CreateEmptyTimeline(tl_name)
if not newtl:
    sys.exit("could not create timeline " + tl_name)
start = newtl.GetStartFrame()
proj.SetCurrentTimeline(newtl)


def seg_frames(i, cfps):
    """Source frames spanning beat-gap i at the clip's OWN fps -> appended back-to-back the
    segments are contiguous (no black-flash gaps) and the cut lands on the beat."""
    return max(1, int(round((nb[i + 1] - nb[i]) * cfps)))


clip_infos = []
short = 0
if clip_paths:
    items = []
    for p in clip_paths:
        imp = mp.ImportMedia([p]) or []
        if not imp:
            sys.exit(f"import failed: {p}")
        items.append(imp[0])
    for i in range(n_seg):
        it = items[i % len(items)]               # cycle clips, in your order; one per beat
        want = seg_frames(i, clip_fps(it))
        seg = min(want, clip_frames(it, want))
        short += seg < want                      # a clip shorter than its beat -> minor drift after it
        clip_infos.append({"mediaPoolItem": it, "startFrame": 0, "endFrame": seg - 1, "mediaType": 1})
else:
    if not src_v1 or not src_v1[0].GetMediaPoolItem():
        sys.exit("no V1 clip to jump-cut (and no --clips) -- put a clip on V1 or pass --clips.")
    item = src_v1[0].GetMediaPoolItem()
    cfps = clip_fps(item)
    max_frame = clip_frames(item, 0)
    if max_frame <= 0:
        sys.exit("could not read source clip length")
    for i in range(n_seg):
        seg = min(seg_frames(i, cfps), max_frame)
        block = int(round(i * max_frame / n_seg))            # even spread across the source
        s = min(max(0, block), max(0, max_frame - seg))      # so each beat = a DIFFERENT moment
        clip_infos.append({"mediaPoolItem": item, "startFrame": s, "endFrame": s + seg - 1, "mediaType": 1})

result = mp.AppendToTimeline(clip_infos)                      # sequential -> contiguous, cuts on beats
n_added = len(result) if isinstance(result, list) else (len(clip_infos) if result else 0)
msg = f"{tl_name}: appended {n_added}/{len(clip_infos)} beat-segments (contiguous, cuts on beats)"
if short:
    msg += f"; {short} clip(s) shorter than their beat -> tiny drift there (use longer clips or --every)"
print(msg)

# Carry the song, head-trimmed by the intro so its beat 1 sits on the first cut.
if src_audio and src_audio[0].GetMediaPoolItem():
    song = src_audio[0].GetMediaPoolItem()
    info = {"mediaPoolItem": song, "startFrame": int(round(base * fps)),
            "recordFrame": start, "mediaType": 2}
    sframes = clip_frames(song, 0)
    if sframes > 0:
        info["endFrame"] = sframes - 1
    if mp.AppendToTimeline([info]):
        print(f"Carried the song onto A1 @ frame {start} (skipped {base:.2f}s intro) -- beats aligned.")
else:
    print("No song on A1 of the source timeline -- built the cut silent (carry your track manually).")

print(f"DONE -- '{tl_name}': footage cuts ON the beats. Effects/transitions/clip-order are YOURS.")

# DELIBERATELY NO auto-effects. This does the DETERMINISTIC part only (cuts on beats).
# Aesthetic choices (zoom, transitions, look, which clip/moment) are taste -> the user's
# call, never auto-applied. See projects/video-pipeline/CLAUDE.md "Division of labor".
