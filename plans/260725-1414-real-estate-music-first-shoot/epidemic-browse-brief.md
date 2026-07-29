# Epidemic Sound browse brief — quirky real estate tour (music-first)

Shoot-to-tempo apartment tour, whip-pan/gyro swing room reveals. Target use: ~90s cut from a full track. Vibe = Riccardo's pick; these constraints stay constant in every prompt:

- **BPM 100–115** (Epidemic lists BPM per track — note it down)
- **Instrumental with wordless human touches** (hums, oohs, vocal chops — no lyrics)
- **Hard, clean downbeat hits/stabs every 4–8 bars** — the swing reveals land on these
- **Clear 4/8-bar phrasing** + at least one energy lift or drop (hero-room reveal)
- An intro that plays over the wall-facing opening; some space in the mix

## Main AI-search prompt (vibe-neutral)
> Music for a modern real estate apartment tour in Malta at the height of summer — sunny, Mediterranean holiday energy. Mostly a smooth, stylish walkthrough cut to the tempo, with one or two playful surprise moments like a whip-pan room reveal. I need a warm, confident groove with punchy drums and a clear beat to cut to, plus the odd sharp accent for those moments. Wordless human vocals — hums, oohs, vocal chops — as a prominent hook, but no lyrics. Around 100 to 115 BPM, playful and stylish, not cheesy.

*(Taste signal from AI take 1, 2026-07-25: Riccardo disliked the tropical marimba/nylon-guitar palette, liked the wordless vocals → favour vocal-forward tracks, skip lounge-y mallet instrumentation.)*

## Variety variants (same constraints, different skin)
1. **Funky retro** — "Funky retro disco groove with slap bass, tight punchy drums and brass stabs. Confident and playful, hard hits on the downbeat, clear phrasing, around 105 BPM, instrumental with a few wordless vocal chops or oohs."
2. **Electro-swing / jazzy quirk** — "Playful electro-swing with a swung beat, brass stabs and upright bass. Mischievous, cheeky energy with sharp accents every few bars, around 110 BPM, instrumental with scat-like wordless vocal touches."
3. **Upbeat indie-pop** — "Bright upbeat indie pop groove with claps, whistles and jangly guitar. Friendly and warm with punchy drum accents and clear sections, around 110 BPM, instrumental with light wordless oohs."
4. **Modern house / lo-fi** — "Clean modern house groove, four-on-the-floor kick, warm bass and crisp percussion. Understated, stylish and current, strong downbeat, clear builds and drops, around 115 BPM, instrumental with chopped wordless vocal samples."
5. **Quirky cinematic** — "Quirky playful cinematic groove with pizzicato strings, marimba, finger snaps and punchy percussion. Mischievous and light on its feet, sharp accents on the downbeat, around 100 BPM, instrumental with human whistles or hums."

## Manual-filter fallback
BPM slider 100–115 · Vocals: Instrumental · Moods: Quirky / Playful / Confident / Groovy — then skim by ear for the hit/phrasing traits above.

## While you're in there
- Download the **stems** of any candidate (free ducking/arrangement room later).

## SFX shopping list (Epidemic SFX library — grab 2–3 variants each, WAV)
- **"whoosh short"** / **"swish air"** — the whip-pan reveals (the signature; tight, not cinematic-trailer)
- **"riser uplifter short"** — build into the hero-room reveal / mid-track lift
- **"impact soft punchy"** / **"thud subtle"** — landing a reveal on the beat
- **"door open close apartment"** + **"keys jingle"** — the entry shot
- **"footsteps tile"** — Malta apartment = tile; transition realism
- **"seagulls distant"** / **"mediterranean street ambience"** / **"waves distant"** — balcony/window/view beat, peak-summer Malta flavour
- **"faucet running"** / **"shower short"** — bathroom detail moments
- **"pop click ding"** — 1–2 tasteful quirky accents for detail shots (use sparingly)

## Handoff
Drag candidates via the Resolve "Soundtracking" plugin (lands in the Resolve project folder) or site-download → send Claude the file path(s) + Epidemic's listed BPM. Multiple candidates welcome — analysis is free. Next step: `estimate_beats.py` + RMS section map → shooting cheat sheet per candidate.
