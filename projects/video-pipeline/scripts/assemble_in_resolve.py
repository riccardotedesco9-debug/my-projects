"""Assemble a finished video + a music track onto a Resolve timeline (video on V1,
music on A1) so the result lands in Resolve to refine/grade/export. RUN VIA fuscript:

    fuscript.exe -l py3 assemble_in_resolve.py --video <video> --audio <audio> [--name NAME]

Resolve must be OPEN. Called automatically by fit_music.py (default path).
"""
import sys
import time


def arg(flag):
    a = sys.argv
    return a[a.index(flag) + 1] if flag in a and a.index(flag) + 1 < len(a) else None


video = arg("--video")
audio = arg("--audio")
name = arg("--name") or ("Scored_%d" % int(time.time()))
if not video or not audio:
    sys.exit("usage: --video <video> --audio <audio> [--name NAME]")

try:
    resolve = bmd.scriptapp("Resolve")  # noqa: F821
except NameError:
    sys.exit("run via fuscript.exe -l py3")
if not resolve:
    sys.exit("Resolve not open")
proj = resolve.GetProjectManager().GetCurrentProject()
if not proj:
    sys.exit("no project open")
mp = proj.GetMediaPool()

# Import separately so we know which item is video vs audio.
vit = mp.ImportMedia([video]) or []
ait = mp.ImportMedia([audio]) or []
if not vit or not ait:
    sys.exit(f"import failed (video={bool(vit)}, audio={bool(ait)})")

tl = mp.CreateTimelineFromClips(name, [vit[0]])     # video defines the timeline (V1)
if not tl:
    sys.exit("timeline create failed: " + name)
proj.SetCurrentTimeline(tl)

# Align the music to where the video actually starts. A bare AppendToTimeline drops the
# music at the playhead/next free slot (it landed ~3min in), so the track played detached.
# GetStart() gives the video's absolute timeline frame regardless of the timeline's start TC.
vitems = tl.GetItemListInTrack("video", 1) or []
start_frame = vitems[0].GetStart() if vitems else 0
res = mp.AppendToTimeline([{"mediaPoolItem": ait[0], "recordFrame": start_frame, "mediaType": 2}])
ok = bool(res)
print(f"Assembled '{name}': video on V1 + music on A1 @ frame {start_frame} -> {'OK' if ok else 'MUSIC APPEND FAILED'}")
print(f"Open Resolve: timeline '{name}' is ready to refine / grade / export.")
