"""sync.py -- one front door for music<->video syncing. Picks the right deterministic path
from two axes; you bring the taste (clips, order, vibe, the final nudge).

  axis 1  --lead  video | music   (video-first = footage is LOCKED, fit music to it;
                                    music-first = footage is RE-CUTTABLE, cut it to the beats)
  axis 2  --music gen   | track    (AI-generated  | your own song)

VIDEO-FIRST (1 step):
  python sync.py edit.mp4 --lead video --music gen   [--prompt "..."] [--flat]   # mode 1 (Sonilo)
  python sync.py edit.mp4 --lead video --music track --track song.mp3 [--flat]   # mode 2 (lay+align)
  (multiple inputs are concatenated first; --lead video never re-cuts your edit.)

MUSIC-FIRST (2 steps -- BeatEdit's 1 click sits in the middle):
  step 1  python sync.py a.mp4 b.mp4 --lead music --music gen --prompt "..." [--vocals] [--length 60]
          python sync.py a.mp4 b.mp4 --lead music --music track --track song.mp3
          -> lays the song on a Resolve 'BeatPrep' timeline; you run BeatEdit on it (1 click).
  step 2  python sync.py a.mp4 b.mp4 --lead music --cut [--every N]
          -> reads the beats, cuts the footage to them (modes 3 & 4).

Plain Python 3 + ffmpeg; gen needs FAL_KEY; Resolve paths need Resolve open. Deterministic only.
"""
import argparse
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fit_music as fm  # reuse fal_key / _api / download / run (DRY)

FUSCRIPT = r"C:\Program Files\Blackmagic Design\DaVinci Resolve\fuscript.exe"
TMP = r"C:\Users\Riccardo\Documents\My Projects\.tmp\creative"


def live(cmd):
    """Run a child with inherited stdio so progress streams to the user. Returns exit code."""
    return subprocess.run(cmd).returncode


def concat(videos, out):
    """ffmpeg concat -> one file (video-first with multiple clips). Re-encodes if codecs differ."""
    listf = out + ".txt"
    with open(listf, "w", encoding="utf-8") as f:
        for v in videos:
            f.write("file '%s'\n" % os.path.abspath(v).replace("'", "'\\''"))
    r = fm.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
                "-i", listf, "-c", "copy", out])
    if r.returncode != 0:
        r = fm.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
                    "-i", listf, "-c:v", "libx264", "-c:a", "aac", out])
    os.remove(listf)
    if r.returncode != 0:
        sys.exit("concat failed:\n" + r.stderr)
    return out


def gen_music(prompt, length_s, vocals, key):
    """Music-first generation. Stable Audio = instrumental/license-clean; ElevenLabs-on-fal = vocals."""
    os.makedirs(TMP, exist_ok=True)
    out = os.path.join(TMP, "_genmusic.mp3")
    if vocals:
        model = "fal-ai/elevenlabs/music"
        body = {"prompt": prompt, "music_length_ms": int(length_s * 1000), "force_instrumental": False}
    else:
        model = "fal-ai/stable-audio-3/medium/text-to-audio"
        body = {"prompt": prompt, "duration": float(length_s)}
    job = fm._api("https://queue.fal.run/" + model, key, body)
    for _ in range(180):                              # up to ~6 min
        st = fm._api(job["status_url"], key)
        if st.get("status") == "COMPLETED":
            return fm.download(fm._api(job["response_url"], key)["audio"]["url"], out)
        if st.get("status") in ("FAILED", "ERROR"):
            sys.exit(f"music gen failed: {st}")
        time.sleep(2)
    sys.exit("music gen timed out")


def video_first(inputs, music, track, prompt, flat, out):
    """Modes 1 & 2: footage is locked -> fit music to it (hand off to fit_music.py)."""
    video = inputs[0]
    if len(inputs) > 1:
        os.makedirs(TMP, exist_ok=True)
        video = concat(inputs, os.path.join(TMP, "_concat.mp4"))
        print(f"Concatenated {len(inputs)} clips -> {video}")
    cmd = [sys.executable, os.path.join(HERE, "fit_music.py"), video]
    if music == "gen":
        cmd += ["--generate"] + (["--prompt", prompt] if prompt else [])
    else:
        cmd += ["--track", track, "--align"]         # mode 2 = lay under + downbeat-align
    if flat:
        cmd += ["--flat"]
    if out:
        cmd += ["--out", out]
    if live(cmd):
        sys.exit("video-first step failed")


def get_song(music, track, prompt, length, vocals):
    """The song for music-first: generated (Stable Audio / ElevenLabs-on-fal) or your track."""
    if music == "gen":
        key = fm.fal_key()
        print(f"Generating {'vocal' if vocals else 'instrumental'} track (~{int(length)}s)...")
        return gen_music(prompt or "instrumental track", length, vocals, key)
    return track


def assemble_prep(footage0, song):
    """Put the song (+ a reference clip) on a Resolve 'BeatPrep' timeline; sets it current."""
    rc = live([FUSCRIPT, "-l", "py3", os.path.join(HERE, "assemble_in_resolve.py"),
               "--video", os.path.abspath(footage0), "--audio", os.path.abspath(song), "--name", "BeatPrep"])
    if rc:
        sys.exit("could not assemble onto a Resolve timeline (is Resolve open?)")


def music_first_prep(inputs, music, track, prompt, length, vocals):
    """Modes 3 & 4, step 1 (BeatEdit flow): song onto a timeline; you click BeatEdit, then --cut."""
    song = get_song(music, track, prompt, length, vocals)
    print(f"Song: {song}")
    assemble_prep(inputs[0], song)
    print("\n[NEXT] In Resolve: select the 'BeatPrep' timeline, run BeatEdit on the song (1 click)")
    print("       to drop beat markers, THEN re-run the same command with  --cut  added.")


def music_first_auto(inputs, music, track, prompt, length, vocals, every):
    """Modes 3 & 4, no-click: estimate beats instead of BeatEdit, then cut in one shot.
    (BeatEdit is more accurate + visually verifiable; this is the fully-automated alternative.)"""
    song = get_song(music, track, prompt, length, vocals)
    print(f"Song: {song}")
    assemble_prep(inputs[0], song)
    os.makedirs(TMP, exist_ok=True)
    beats = os.path.join(TMP, "_autobeats.json")
    if live([sys.executable, os.path.join(HERE, "estimate_beats.py"), song, "--out", beats]):
        sys.exit("beat estimation failed")
    if live([FUSCRIPT, "-l", "py3", os.path.join(HERE, "resolve_beat_markers.py"), "--from-json", beats]):
        sys.exit("marker injection failed")
    music_first_cut(inputs, every)


def music_first_cut(inputs, every):
    """Modes 3 & 4, step 2: read BeatEdit's beats and cut the footage to them."""
    cmd = [FUSCRIPT, "-l", "py3", os.path.join(HERE, "resolve_autocut.py"), "--every", str(every)]
    if len(inputs) > 1:
        cmd += ["--clips"] + [os.path.abspath(p) for p in inputs]   # one clip per beat
    # single input -> jump-cut the V1 clip already on the current (BeatPrep) timeline
    if live(cmd):
        sys.exit("beat-cut failed (is BeatPrep the current timeline, with markers?)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+", help="one or more video files (clips, or one file)")
    ap.add_argument("--lead", choices=["video", "music"], required=True)
    ap.add_argument("--music", choices=["gen", "track"], default="gen")
    ap.add_argument("--track", help="your song (required for --music track)")
    ap.add_argument("--prompt", help="style steer for generated music")
    ap.add_argument("--length", type=float, default=60, help="generated song length (s), music-first")
    ap.add_argument("--vocals", action="store_true", help="music-first gen: vocals (ElevenLabs-on-fal)")
    ap.add_argument("--every", type=int, default=1, help="music-first: use every Nth beat (density)")
    ap.add_argument("--flat", action="store_true", help="video-first: flat MP4 instead of Resolve")
    ap.add_argument("--out", help="video-first output path")
    ap.add_argument("--cut", action="store_true", help="music-first step 2: build the cut after BeatEdit")
    ap.add_argument("--auto-beats", action="store_true",
                    help="music-first: skip BeatEdit, auto-detect beats in one shot (no-click; less accurate)")
    a = ap.parse_args()

    for p in a.inputs:
        if not os.path.isfile(p):
            sys.exit(f"input not found: {p}")
    if a.music == "track" and not (a.track and os.path.isfile(a.track)):
        sys.exit("--music track needs --track <existing file>")

    if a.lead == "video":
        video_first(a.inputs, a.music, a.track, a.prompt, a.flat, a.out)
    elif a.cut:
        music_first_cut(a.inputs, a.every)
    elif a.auto_beats:
        music_first_auto(a.inputs, a.music, a.track, a.prompt, a.length, a.vocals, a.every)
    else:
        music_first_prep(a.inputs, a.music, a.track, a.prompt, a.length, a.vocals)


if __name__ == "__main__":
    main()
