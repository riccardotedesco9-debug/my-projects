"""Auto-cut to beat. Reads the beat markers on the CURRENT timeline (e.g. the ones
BeatEdit dropped), then slices that timeline's source video clip into one segment per
beat onto a new 'AutoCut' timeline. RUN VIA fuscript:

    & "C:\\Program Files\\Blackmagic Design\\DaVinci Resolve\\fuscript.exe" -l py3 resolve_autocut.py

Prereq: Resolve open; current timeline has the video clip on V1 + beat markers.
This is the "automate then refine" payoff: cuts land on beats; you tweak after.
"""
import sys

try:
    resolve = bmd.scriptapp("Resolve")  # noqa: F821  (injected by fuscript)
except NameError:
    sys.exit("run via fuscript.exe -l py3")
if not resolve:
    sys.exit("Resolve not open")

proj = resolve.GetProjectManager().GetCurrentProject()
mp = proj.GetMediaPool()
src = proj.GetCurrentTimeline()
if not src:
    sys.exit("no current timeline")
fps = float(src.GetSetting("timelineFrameRate") or 30)

markers = src.GetMarkers() or {}
beat_frames = sorted(markers)
if len(beat_frames) < 2:
    sys.exit(f"need >=2 beat markers on the current timeline (have {len(beat_frames)}) -- run BeatEdit first.")
beat_secs = [f / fps for f in beat_frames]
print(f"{len(beat_frames)} beat markers -> {len(beat_secs) - 1} segments")

vid = src.GetItemListInTrack("video", 1) or []
if not vid:
    sys.exit("no video clip on V1 of the current timeline")
item = vid[0].GetMediaPoolItem()
if not item:
    sys.exit("could not resolve the source MediaPoolItem")
clip_fps = float(item.GetClipProperty("FPS") or fps)

clip_infos = []
for i in range(len(beat_secs) - 1):
    s = int(round(beat_secs[i] * clip_fps))
    e = int(round(beat_secs[i + 1] * clip_fps)) - 1
    if e > s:
        clip_infos.append({"mediaPoolItem": item, "startFrame": s, "endFrame": e})

newtl = mp.CreateEmptyTimeline("AutoCut")
proj.SetCurrentTimeline(newtl)
ok = mp.AppendToTimeline(clip_infos)
print(f"AutoCut: appended {len(clip_infos)} beat-segments -> {'OK' if ok else 'FAILED'}")
print("DONE -- check Resolve: 'AutoCut' timeline, clip sliced on every beat.")
