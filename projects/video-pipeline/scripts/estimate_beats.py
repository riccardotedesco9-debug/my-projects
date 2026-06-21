"""OPTIONAL no-click beat estimator -> beats.json (seconds). Pure stdlib + ffmpeg (no librosa).

    python estimate_beats.py song.mp3 [--out beats.json] [--start 0] [--dur 60] [--min-bpm 70] [--max-bpm 170]

The ACCURATE path for real work is BeatEdit (1 click, visually verifiable). This is a fallback
for a fully no-click music-first run / quick demos: it finds a single steady tempo grid via an
onset-envelope autocorrelation. Feed the JSON to Resolve with:
    fuscript.exe -l py3 resolve_beat_markers.py --from-json beats.json
"""
import argparse
import json
import subprocess
import sys
from array import array

SR = 22050
HOP = 512
ENV_SR = SR / HOP  # onset-envelope frames per second


def decode_mono(path, start, dur):
    cmd = ["ffmpeg", "-v", "error"]
    if start:
        cmd += ["-ss", str(start)]
    cmd += ["-i", path]
    if dur:
        cmd += ["-t", str(dur)]
    cmd += ["-ac", "1", "-ar", str(SR), "-f", "s16le", "-"]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0 or not r.stdout:
        sys.exit("ffmpeg decode failed:\n" + r.stderr.decode(errors="ignore"))
    buf = r.stdout
    if len(buf) % 2:
        buf = buf[:-1]
    return array("h", buf)


def onset_env(samples):
    n = len(samples) // HOP
    energy = [0.0] * n
    for i in range(n):
        base = i * HOP
        s = 0
        for j in range(base, base + HOP):
            v = samples[j]
            s += v * v
        energy[i] = s
    env = [0.0] * n
    for i in range(1, n):
        d = energy[i] - energy[i - 1]
        env[i] = d if d > 0 else 0.0           # half-wave rectified energy flux
    return env


def best_lag(env, min_bpm, max_bpm):
    lo = int(round(ENV_SR * 60.0 / max_bpm))   # fast tempo -> small lag
    hi = int(round(ENV_SR * 60.0 / min_bpm))
    lo, hi = max(2, lo), min(len(env) - 2, hi)
    if hi <= lo:
        sys.exit("clip too short to estimate tempo")
    ac = {}
    for lag in range(lo, hi + 1):
        ac[lag] = sum(env[i] * env[i + lag] for i in range(len(env) - lag))
    peak = max(ac, key=ac.get)
    a, b, c = ac.get(peak - 1, 0.0), ac[peak], ac.get(peak + 1, 0.0)
    denom = a - 2 * b + c
    delta = 0.5 * (a - c) / denom if denom else 0.0   # parabolic sub-frame refine -> less drift
    return peak + max(-0.5, min(0.5, delta))


def best_phase(env, lag):
    best_off, best_score = 0, -1.0
    n = len(env)
    for off in range(int(round(lag))):
        score, t = 0.0, float(off)
        while t < n:
            idx = int(round(t))
            if idx < n:                          # round() can land on n at the tail
                score += env[idx]
            t += lag
        if score > best_score:
            best_off, best_score = off, score
    return best_off


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--out")
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--dur", type=float, default=0.0)
    ap.add_argument("--min-bpm", type=float, default=70.0)
    ap.add_argument("--max-bpm", type=float, default=170.0)
    a = ap.parse_args()

    env = onset_env(decode_mono(a.audio, a.start, a.dur))
    lag = best_lag(env, a.min_bpm, a.max_bpm)
    off = best_phase(env, lag)
    bpm = 60.0 * ENV_SR / lag

    beats, t = [], float(off)
    while t < len(env):
        beats.append(round(a.start + t / ENV_SR, 3))
        t += lag
    out = a.out or (a.audio.rsplit(".", 1)[0] + ".beats.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"bpm": round(bpm, 1), "beats": beats}, f)
    print(f"~{bpm:.1f} BPM, {len(beats)} beats -> {out}")


if __name__ == "__main__":
    main()
