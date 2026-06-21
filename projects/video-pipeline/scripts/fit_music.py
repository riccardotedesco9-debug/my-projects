"""fit-music: add fitting music to a FINISHED/edited video (you cut it; this scores it).

  python fit_music.py <video> --generate          # fal Sonilo generates music fitted to your edit
  python fit_music.py <video> --track <audio>     # lay YOUR song under, trimmed+faded to length
  optional: --flat (muxed MP4 instead of Resolve)  --out <path>  --fade <sec=2>  --num <=1>

DEFAULT: assembles your video + music onto a Resolve TIMELINE (Resolve must be open) so you
finish/grade/export there. Use --flat for a quick muxed MP4 with no Resolve.
Plain Python 3 + ffmpeg; --generate needs FAL_KEY (env or workspace .env); default path needs Resolve open.

Deterministic only. NOTE: aligning your OWN track's beats to your cut points is taste/precision
-> do that manually in Resolve (or Premiere 'Remix'); this just lays it under cleanly.
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

WORKSPACE = r"C:\Users\Riccardo\Documents\My Projects"


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def ffprobe_duration(path):
    r = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path])
    try:
        return float(r.stdout.strip())
    except ValueError:
        sys.exit(f"ffprobe couldn't read duration of {path}\n{r.stderr}")


def fal_key():
    k = os.environ.get("FAL_KEY")
    if k:
        return k
    envf = os.path.join(WORKSPACE, ".env")          # fallback: workspace .env (primary secrets store)
    if os.path.isfile(envf):
        for line in open(envf, encoding="utf-8"):
            if line.strip().startswith("FAL_KEY="):
                return line.split("=", 1)[1].strip().strip('"')
    sys.exit("FAL_KEY not in env or .env — needed for --generate")


def _api(url, key, data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, method="POST" if data is not None else "GET")
    req.add_header("Authorization", f"Key {key}")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def upload_to_fal(path, key):
    init = _api("https://rest.alpha.fal.ai/storage/upload/initiate", key,
                {"file_name": os.path.basename(path), "content_type": "video/mp4"})
    put = urllib.request.Request(init["upload_url"], data=open(path, "rb").read(), method="PUT")
    put.add_header("Content-Type", "video/mp4")
    urllib.request.urlopen(put)
    return init["file_url"]


def sonilo(video_url, key, num):
    job = _api("https://queue.fal.run/sonilo/v1.1/video-to-music", key,
               {"video_url": video_url, "num_samples": num})
    for _ in range(120):                              # up to ~4 min
        st = _api(job["status_url"], key)
        if st.get("status") == "COMPLETED":
            return _api(job["response_url"], key)["audio"]["url"]
        if st.get("status") in ("FAILED", "ERROR"):
            sys.exit(f"Sonilo failed: {st}")
        time.sleep(2)
    sys.exit("Sonilo timed out")


def download(url, out):
    urllib.request.urlretrieve(url, out)
    return out


def mux(video, audio, out, dur, fade):
    af = f"afade=t=out:st={max(0, dur - fade):.3f}:d={fade}"
    r = run(["ffmpeg", "-y", "-loglevel", "error", "-i", video, "-i", audio,
             "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac",
             "-af", af, "-t", f"{dur:.3f}", out])
    if r.returncode != 0:
        sys.exit(f"ffmpeg mux failed:\n{r.stderr}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--generate", action="store_true")
    g.add_argument("--track")
    ap.add_argument("--out")
    ap.add_argument("--flat", action="store_true", help="flat muxed MP4 instead of assembling in Resolve")
    ap.add_argument("--fade", type=float, default=2.0)
    ap.add_argument("--num", type=int, default=1)
    a = ap.parse_args()

    if not os.path.isfile(a.video):
        sys.exit(f"video not found: {a.video}")
    dur = ffprobe_duration(a.video)
    out = a.out or os.path.splitext(a.video)[0] + "_scored.mp4"
    workdir = os.path.dirname(os.path.abspath(out))

    if a.generate:
        key = fal_key()
        print(f"Uploading edit to fal ({dur:.1f}s)...")
        url = upload_to_fal(a.video, key)
        print("Generating fitted music (Sonilo)...")
        audio_url = sonilo(url, key, a.num)
        audio = download(audio_url, os.path.join(workdir, "_fit_generated.m4a"))
    else:
        if not os.path.isfile(a.track):
            sys.exit(f"track not found: {a.track}")
        audio = a.track
        print(f"Using your track: {os.path.basename(audio)}")

    if a.flat:
        mux(a.video, audio, out, dur, a.fade)
        print(f"DONE (flat MP4) -> {out}")
    else:
        fuscript = r"C:\Program Files\Blackmagic Design\DaVinci Resolve\fuscript.exe"
        assemble = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assemble_in_resolve.py")
        r = run([fuscript, "-l", "py3", assemble,
                 "--video", os.path.abspath(a.video), "--audio", os.path.abspath(audio)])
        sys.stdout.write(r.stdout)
        if r.returncode != 0:
            sys.exit("Resolve assembly failed (is Resolve open?):\n" + r.stderr)


if __name__ == "__main__":
    main()
