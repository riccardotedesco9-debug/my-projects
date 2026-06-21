"""Verify the Resolve scripting connection. RUN VIA fuscript (Resolve's embedded
interpreter) -- NOT plain python:

    & "C:\\Program Files\\Blackmagic Design\\DaVinci Resolve\\fuscript.exe" -l py3 resolve_connect_test.py

Why fuscript: external Python crashes loading Resolve 21's fusionscript.dll
(0xC0000005). fuscript runs inside Resolve's engine where `bmd` is injected.
Resolve must be OPEN.
"""
import sys

try:
    resolve = bmd.scriptapp("Resolve")  # noqa: F821  (bmd injected by fuscript)
except NameError:
    sys.exit("ERROR: `bmd` undefined -- run this via fuscript.exe -l py3, not plain python.")

if not resolve:
    sys.exit("ERROR: Resolve not reachable -- is it OPEN (Studio)?")

print("CONNECTED:", resolve.GetProductName(), resolve.GetVersionString())
proj = resolve.GetProjectManager().GetCurrentProject()
print("Project :", proj.GetName() if proj else "(no project)")
tl = proj.GetCurrentTimeline() if proj else None
print("Timeline:", tl.GetName() if tl else "(no timeline)")
if tl:
    markers = tl.GetMarkers() or {}
    fps = float(tl.GetSetting("timelineFrameRate") or 30)
    print(f"Markers : {len(markers)}")
    for frame in sorted(markers)[:15]:
        info = markers[frame]
        print(f"  @{frame / fps:7.2f}s  frame {frame:>6}  {info.get('color','?'):<8} {info.get('name','')}")
print("OK: API live and readable.")
