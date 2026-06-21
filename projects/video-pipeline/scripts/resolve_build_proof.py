"""Comprehensive-control proof: import media -> build a timeline -> add markers,
all via the Resolve API. RUN VIA fuscript:
    fuscript.exe -l py3 resolve_build_proof.py
Adds a new timeline 'API_Proof' to the current project (additive, non-destructive).
"""
import sys

CLIP = r"C:\Users\Riccardo\Documents\My Projects\.tmp\creative\260621-mareux-test\clip30_silent.mp4"
MUSIC = r"C:\Users\Riccardo\Documents\My Projects\.tmp\creative\260621-mareux-test\music.m4a"

try:
    resolve = bmd.scriptapp("Resolve")  # noqa: F821
except NameError:
    sys.exit("run via fuscript.exe -l py3")
if not resolve:
    sys.exit("Resolve not open")

proj = resolve.GetProjectManager().GetCurrentProject()
mp = proj.GetMediaPool()

print("Importing media...")
items = mp.ImportMedia([CLIP, MUSIC]) or []
print("  imported:", [i.GetName() for i in items] if items else "NONE")
if not items:
    sys.exit("import failed")

print("Creating timeline 'API_Proof'...")
tl = mp.CreateTimelineFromClips("API_Proof", items)
if not tl:
    sys.exit("timeline create failed")
proj.SetCurrentTimeline(tl)
fps = float(tl.GetSetting("timelineFrameRate") or 30)
print(f"  timeline: {tl.GetName()}  @{fps}fps")

print("Adding markers...")
for i, s in enumerate([1.0, 2.0, 3.0, 4.0], 1):
    ok = tl.AddMarker(int(round(s * fps)), "Cyan", f"beat-{i}", "via Resolve API", 1)
    print(f"  @{s:.1f}s: {'OK' if ok else 'FAIL'}")

print("Total markers now:", len(tl.GetMarkers() or {}))
print("DONE - check Resolve: timeline 'API_Proof' with clip + music + markers.")
