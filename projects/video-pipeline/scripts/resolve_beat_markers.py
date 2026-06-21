"""Beat markers <-> Resolve. RUN VIA fuscript (Resolve's embedded interpreter):

    fuscript.exe -l py3 resolve_beat_markers.py              # read current timeline markers (e.g. BeatEdit's)
    fuscript.exe -l py3 resolve_beat_markers.py --demo-write # add 3 test markers (proves write control)
    fuscript.exe -l py3 resolve_beat_markers.py --from-json beats.json  # add markers from a timestamps file

The hybrid: you run BeatEdit (1 click) -> it drops beat markers -> this reads them
and automates the rest. `--from-json` is the no-click bridge: an external Python 3.10
runs librosa to write beats.json (seconds), then this adds them as markers.
Resolve must be OPEN.
"""
import sys
import json

try:
    resolve = bmd.scriptapp("Resolve")  # noqa: F821  (bmd injected by fuscript)
except NameError:
    sys.exit("ERROR: run via fuscript.exe -l py3 (bmd is undefined in plain python).")
if not resolve:
    sys.exit("ERROR: Resolve not reachable -- is it OPEN?")

proj = resolve.GetProjectManager().GetCurrentProject()
if not proj:
    sys.exit("ERROR: no project open.")
tl = proj.GetCurrentTimeline()
if not tl:
    sys.exit("ERROR: no current timeline.")
fps = float(tl.GetSetting("timelineFrameRate") or 30)
args = sys.argv[1:]


def read_markers():
    markers = tl.GetMarkers() or {}
    print(f"'{tl.GetName()}' has {len(markers)} marker(s):")
    for frame in sorted(markers):
        info = markers[frame]
        print(f"  @{frame / fps:7.2f}s  frame {frame:>6}  {info.get('color','?'):<8} {info.get('name','')}")
    if not markers:
        print("  (none -- run BeatEdit on a music clip first, or use --demo-write / --from-json)")


def add_at_seconds(seconds, color="Yellow", name="beat", note=""):
    added = 0
    for t in seconds:
        if tl.AddMarker(int(round(float(t) * fps)), color, name, note, 1):
            added += 1
    print(f"Added {added}/{len(seconds)} markers to '{tl.GetName()}'.")


if "--demo-write" in args:
    add_at_seconds([1.0, 2.0, 3.0], color="Cyan", name="test", note="via Resolve API")
    print("--- read back ---")
    read_markers()
elif "--from-json" in args:
    i = args.index("--from-json")
    if i + 1 >= len(args):
        sys.exit("usage: --from-json <path-to-beats.json>")
    path = args[i + 1]
    with open(path) as f:
        beats = json.load(f)  # list of seconds, or {"beats":[...]}
    add_at_seconds(beats["beats"] if isinstance(beats, dict) else beats)
else:
    read_markers()
