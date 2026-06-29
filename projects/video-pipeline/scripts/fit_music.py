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
import glob
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

WORKSPACE = r"C:\Users\Riccardo\Documents\My Projects"


def run(cmd, cwd=None):
    return subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)


GRAB_DIR = os.path.join(WORKSPACE, ".tmp", "creative")   # gitignored; safe for grabbed audio
_AUDIO_EXTS = (".mp3", ".m4a", ".opus", ".flac", ".wav", ".ogg")
_SPOTIFY = ("spotify:", "open.spotify.com")
_YOUTUBE = ("youtube.com", "youtu.be")


def _slug(s):
    """Filesystem-safe stem from a URL/URI (keeps the trailing id)."""
    keep = "".join(c if c.isalnum() else "_" for c in s).strip("_")
    return keep[-40:] or "track"


def grab_track(track):
    """Resolve a --track value to a local audio file. A Spotify URL/URI is grabbed via spotdl, a
    YouTube URL via yt-dlp (both invoked `python -m ...` since the console scripts aren't on PATH);
    anything else is treated as an existing local path. Grabs are lossy + personal-use only;
    licensed/commercial music = Epidemic Sound, dragged in via the Resolve plugin (pass that path)."""
    low = track.lower()
    if any(m in low for m in _SPOTIFY):
        return _grab_spotify(track)
    if any(m in low for m in _YOUTUBE):
        return _grab_youtube(track)
    if not os.path.isfile(track):
        sys.exit(f"track not found: {track}")
    return track


def _grab_dir(prefix, url):
    """Fresh per-URL scratch subfolder under GRAB_DIR, cleared each run so a prior/partial grab can
    never win the file-pick. (Always-fresh: re-grabbing re-downloads; predictable > cached.)"""
    sub = os.path.join(GRAB_DIR, prefix + _slug(url))
    shutil.rmtree(sub, ignore_errors=True)
    os.makedirs(sub, exist_ok=True)
    return sub


def _pick_audio(sub, tool, r):
    """The single audio file this run produced in `sub`; errors out clearly if the grab failed."""
    if r.returncode != 0:
        sys.exit(f"{tool} grab failed (installed? `python -m pip install {tool}`):\n"
                 + (r.stderr or r.stdout or "")[-400:])
    got = [f for f in glob.glob(os.path.join(sub, "*")) if f.lower().endswith(_AUDIO_EXTS)]
    if not got:
        sys.exit(f"{tool} produced no audio file:\n" + (r.stdout or "")[-400:])
    return max(got, key=os.path.getmtime)


def _grab_spotify(url):
    sub = _grab_dir("_spotify_", url)
    print(f"Grabbing from Spotify via spotdl: {url}")
    # Run IN `sub` with a bare-filename template: spotdl sanitizes a dotted dir like ".tmp" out of a
    # path given in --output (writes to "tmp" instead), so we set cwd and keep the template path-free.
    return _pick_audio(sub, "spotdl",
                       run([sys.executable, "-m", "spotdl", "download", url,
                            "--output", "{title}.{output-ext}"], cwd=sub))


def _grab_youtube(url):
    sub = _grab_dir("_yt_", url)
    print(f"Grabbing from YouTube via yt-dlp: {url}")
    return _pick_audio(sub, "yt-dlp",
                       run([sys.executable, "-m", "yt_dlp", "-x", "--audio-format", "mp3",
                            "--no-playlist", "-o", "%(title)s.%(ext)s", url], cwd=sub))


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
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:        # fal failures surface as 4xx/5xx, not a status string
        sys.exit(f"fal API error {e.code} at {url}:\n{e.read().decode(errors='ignore')[:300]}")


def upload_to_fal(path, key):
    init = _api("https://rest.alpha.fal.ai/storage/upload/initiate", key,
                {"file_name": os.path.basename(path), "content_type": "video/mp4"})
    put = urllib.request.Request(init["upload_url"], data=open(path, "rb").read(), method="PUT")
    put.add_header("Content-Type", "video/mp4")
    urllib.request.urlopen(put)
    return init["file_url"]


def sonilo(video_url, key, num, prompt=None):
    body = {"video_url": video_url, "num_samples": num}
    if prompt:
        body["prompt"] = prompt          # steer style; Sonilo still paces to the video's cuts
    job = _api("https://queue.fal.run/sonilo/v1.1/video-to-music", key, body)
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


def _first_cut(video):
    """First hard cut in the footage (seconds), via ffmpeg scene detection. None if none found."""
    r = run(["ffmpeg", "-i", video, "-filter:v", "select='gt(scene,0.3)',showinfo",
             "-f", "null", "-"])
    for line in r.stderr.splitlines():
        if "pts_time:" in line:
            try:
                return float(line.split("pts_time:")[1].split()[0])
            except (IndexError, ValueError):
                continue
    return None


def _first_onset(audio):
    """When the song's first sound hits (seconds). 0 if it starts loud; the leading-silence
    end if it fades in. Measured with ffmpeg silencedetect (no librosa)."""
    r = run(["ffmpeg", "-i", audio, "-af", "silencedetect=noise=-30dB:d=0.1", "-f", "null", "-"])
    start, end = None, None
    for line in r.stderr.splitlines():
        if "silence_start:" in line and start is None:
            try:
                start = float(line.split("silence_start:")[1].split()[0])
            except (IndexError, ValueError):
                pass
        elif "silence_end:" in line and end is None:
            try:
                end = float(line.split("silence_end:")[1].split()[0])
            except (IndexError, ValueError):
                pass
    if start is not None and start < 0.3 and end is not None:  # only count an intro-silence
        return end
    return 0.0


EARLY_CUT = 4.0  # only snap the downbeat to the first cut if that cut is within the opening


def align_audio(audio, video, workdir):
    """Mode-2 best-effort: get the song STARTING right. Trim its leading silence so music
    begins at t=0; if the footage's first cut is early, snap the song's first hit onto it.
    Deterministic + measurable (prints the numbers); NOT per-cut sync -- you nudge from there."""
    cut = _first_cut(video)
    onset = _first_onset(audio)
    if cut is not None and cut <= EARLY_CUT:
        target, why = cut, f"first cut @ {cut:.2f}s is early -> snap song's first hit to it"
    else:
        target = 0.0
        why = (f"first cut @ {cut:.2f}s is late" if cut is not None else "no hard cut found") + " -> start song at t=0"
    shift = target - onset
    print(f"align: song onset @ {onset:.2f}s; {why}; shift {shift:+.2f}s")
    if abs(shift) < 0.03:
        return audio
    if shift > 0:                                   # push the song's hit later
        af = f"adelay={int(shift * 1000)}:all=1"
    else:                                           # trim the song's head (drop dead air / move earlier)
        af = f"atrim=start={-shift:.3f},asetpts=PTS-STARTPTS"
    out = os.path.join(workdir, "_aligned.m4a")
    r = run(["ffmpeg", "-y", "-loglevel", "error", "-i", audio, "-af", af, "-c:a", "aac", out])
    if r.returncode != 0:
        print(f"align: ffmpeg offset failed, using the song unshifted:\n{r.stderr}")
        return audio
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
    ap.add_argument("--prompt", help="style steer for --generate, e.g. 'dark gothic synthwave'")
    ap.add_argument("--align", action="store_true",
                    help="(with --track) offset your song so its first hit lands on the footage's first cut")
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
        audio_url = sonilo(url, key, a.num, a.prompt)
        audio = download(audio_url, os.path.join(workdir, "_fit_generated.m4a"))
    else:
        audio = grab_track(a.track)          # local file, or grab a Spotify/YouTube URL
        print(f"Using your track: {os.path.basename(audio)}")
        if a.align:
            audio = align_audio(audio, a.video, workdir)

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
