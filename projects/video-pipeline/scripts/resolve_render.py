"""Render a timeline to an MP4 via the Resolve API. RUN VIA fuscript:
    fuscript.exe -l py3 resolve_render.py [TimelineName] [OutDir]
Defaults: current timeline -> .tmp/creative/resolve-out/. H.264 MP4, whole timeline.
Resolve must be OPEN.
"""
import os
import sys
import time

DEFAULT_OUT = r"C:\Users\Riccardo\Documents\My Projects\.tmp\creative\resolve-out"

try:
    resolve = bmd.scriptapp("Resolve")  # noqa: F821
except NameError:
    sys.exit("run via fuscript.exe -l py3")
if not resolve:
    sys.exit("Resolve not open")

args = [a for a in sys.argv[1:]]
tl_name = args[0] if len(args) >= 1 else None
out_dir = args[1] if len(args) >= 2 else DEFAULT_OUT

proj = resolve.GetProjectManager().GetCurrentProject()
if not proj:
    sys.exit("no project open")

# Pick the timeline: by name if given, else current.
tl = None
if tl_name:
    for i in range(1, proj.GetTimelineCount() + 1):
        t = proj.GetTimelineByIndex(i)
        if t and t.GetName() == tl_name:
            tl = t
            break
    if not tl:
        sys.exit(f"timeline '{tl_name}' not found")
    proj.SetCurrentTimeline(tl)
else:
    tl = proj.GetCurrentTimeline()
if not tl:
    sys.exit("no timeline to render")

name = tl.GetName().replace(" ", "_")
print(f"Rendering '{tl.GetName()}' -> {out_dir}\\{name}.mp4")

os.makedirs(out_dir, exist_ok=True)  # Resolve won't create the target dir itself
# ExportAudio defaults OFF for a bare H.264/mp4 job -> the file came out SILENT. Force both
# streams + an audio codec so the rendered MP4 actually carries the music.
if not proj.SetRenderSettings({"TargetDir": out_dir, "CustomName": name, "SelectAllFrames": True,
                               "ExportVideo": True, "ExportAudio": True, "AudioCodec": "aac"}):
    sys.exit("SetRenderSettings rejected (bad TargetDir?)")
if not proj.SetCurrentRenderFormatAndCodec("mp4", "H264"):
    sys.exit("format/codec rejected (mp4/H264)")
proj.DeleteAllRenderJobs()
job_id = proj.AddRenderJob()
if not job_id:
    sys.exit("AddRenderJob failed")
if not proj.StartRendering(job_id):
    sys.exit("StartRendering failed -- nothing rendered")

waited = 0
while proj.IsRenderingInProgress():
    time.sleep(1)
    waited += 1
    if waited > 1800:  # 30-min hard cap so a stalled/modal render can't hang forever
        sys.exit("render timed out (>30min) -- check Resolve for a dialog/stall")

status = proj.GetRenderJobStatus(job_id) or {}
js = status.get("JobStatus")
print("Render status:", js, status.get("CompletionPercentage"), "%")
if js != "Complete":
    sys.exit(f"render did NOT complete: {js}")
print(f"DONE -> {out_dir}\\{name}.mp4")
