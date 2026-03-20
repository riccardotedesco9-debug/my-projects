"""
npc-dialog-generator.py
Generates ElevenLabs MP3 audio for all NPC dialog lines using the 'volition' voice.
Output: game/assets/audio/npc-{scene}-{npc}-{n}.mp3

Usage:
  python npc-dialog-generator.py           # skip existing
  python npc-dialog-generator.py --force   # regenerate all

Requirements:
  pip install elevenlabs python-dotenv
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from elevenlabs import ElevenLabs
from elevenlabs.types import VoiceSettings

load_dotenv()
API_KEY  = os.getenv('ELEVENLABS_API_KEY')
VOICE_ID = '1o0lH452oO24WHDBH4Db'   # volition
OUT_DIR  = Path(__file__).parent / 'game' / 'assets' / 'audio'

VOICE_SETTINGS = VoiceSettings(
    stability=0.38,
    similarity_boost=0.80,
    style=0.45,
    use_speaker_boost=True,
)

NPC_LINES = [
    # ── Scene 1 — Asbury Park ─────────────────────────────────────────────────
    ('npc-asbury-mom-0',     "DANNY! Get your ass inside! The meatballs are getting cold and I did not cook for three hours so you could stare at the MOON!"),
    ('npc-asbury-mom-1',     "You got a fire in you, piccolo. A beautiful, terrifying fire. God help the world when it finds out."),
    ('npc-asbury-kid-0',     "Hey DeVito! I heard you talking to a pigeon again! I heard the whole conversation! You were LOSING!"),
    ('npc-asbury-kid-1',     "My dad says you're gonna end up in a ditch! He also lives in a ditch, so maybe take that with a grain of salt!"),
    ('npc-asbury-sal-0',     "Thirty-two years on this corner. Know what I've learned? Nothing. Absolutely nothing. But that kid is different."),
    ('npc-asbury-sal-1',     "Whatever he's got in him, it's either gonna make him very famous or get him arrested. Maybe both. Probably both."),

    # ── Scene 2 — Beauty School ───────────────────────────────────────────────
    ('npc-beauty-prof-0',    "Mr. DeVito, your technique is what I would describe as aggressively wrong yet somehow producing transcendent results. I've never been more confused in my professional life."),
    ('npc-beauty-prof-1',    "You just gave a man a haircut while arguing with the mirror. The client is crying. He says it's beautiful. I don't understand anything anymore."),
    ('npc-beauty-gloria-0',  "DANNY. What did you do to my hair? It's INCREDIBLE. I feel like a dangerous woman. A woman who makes reckless financial decisions."),
    ('npc-beauty-gloria-1',  "I'm naming something after you. A child, a pet, a boat, something. I don't know what yet but it's happening."),
    ('npc-beauty-pete-0',    "Kid, I had a dream once. I was gonna be an international jazz dancer. Never happened. Don't be like me. Be less like me every single day."),
    ('npc-beauty-pete-1',    "Get out of here. Go do whatever insane thing you're gonna do. I'll finish the haircut myself. I've seen enough to know the back."),

    # ── Scene 3 — Taxi Depot ─────────────────────────────────────────────────
    ('npc-taxi-louie-0',     "REIGER! Every day I wake up and I think: today is the day I become a better person. Then I see your face and I dock someone for no reason and I feel GREAT."),
    ('npc-taxi-louie-1',     "This cage is my kingdom. These cabs are my subjects. You are my enemies. I love this job more than I've ever loved anything."),
    ('npc-taxi-alex-0',      "Louie, I've been driving cabs for eight years and every single day you find a brand new and creative way to make it worse. I'm keeping a journal. There's enough for a book."),
    ('npc-taxi-alex-1',      "I don't hate you, Louie. I want to. I've tried for years. But there's something about you that I can only describe as admirably terrible. It's deeply upsetting."),
    ('npc-taxi-jim-0',       "Hey. Quick question. Is this still the 70s? Because I started a conversation in 1972 and I want to finish it but I cannot find the person."),
    ('npc-taxi-jim-1',       "Also, what is a cab. I've been driving one for years. I just want someone to explain what it is. Philosophically. Take your time."),

    # ── Scene 4 — Gotham City ─────────────────────────────────────────────────
    ('npc-gotham-tim-0',     "Danny, I gave you a script. You looked at it, put it down, and did something completely different that was somehow better. I've stopped fighting it."),
    ('npc-gotham-tim-1',     "The makeup team handed in their notice after week three. I rehired them. They cried. You didn't notice because you were eating a fish. This is cinema."),
    ('npc-gotham-citizen-0', "IT'S THE PENGUIN! He's right there! He's looking at me! Oh god, he's STILL looking at me!"),
    ('npc-gotham-citizen-1', "He just bit that man's nose. He bit it. There was no provocation. There was only intention. So much intention."),
    ('npc-gotham-rhea-0',    "Danny, our youngest asked why daddy looks like a monster on TV. I said: because daddy IS a monster, and that's why we love him."),
    ('npc-gotham-rhea-1',    "They're drawing you as the Penguin in school. Their teacher is concerned. I'm not."),

    # ── Scene 5 — Paddy's Pub ─────────────────────────────────────────────────
    ('npc-paddys-charlie-0', "FRANK! I need help! I was fixing the pipes and now something that should be dry is wet and something that should be wet is somehow on fire!"),
    ('npc-paddys-charlie-1', "Also the rats are organized now. Like, properly organized. They had a MEETING, Frank. I heard them. They voted on something."),
    ('npc-paddys-mac-0',     "Frank, I've been thinking about God and my body and whether God is happy with my body and whether my body is doing God's work. My karate specifically."),
    ('npc-paddys-mac-1',     "Frank, what is that you're eating. Frank. FRANK. Put that down. That's not food. Where did you even get that."),
    ('npc-paddys-dennis-0',  "Frank, I need you to acknowledge verbally that I am the smartest person in this pub. Not for my ego. For science. It needs to be documented."),
    ('npc-paddys-dennis-1',  "Your plan involves the sewer. I can always tell. Your eyes go to a specific place when you're thinking about the sewer and they're there right now."),
    ('npc-paddys-dee-0',     "Frank, I got an audition. A real one. Don't make a face like that. Stop making that face. Your face is doing something right now and I need it to stop."),
    ('npc-paddys-dee-1',     "It's a bird food commercial, isn't it. You knew. You've known this whole time and you were waiting to watch my face fall. I hate this family."),
]


def generate_line(client, key, text, force=False):
    out_path = OUT_DIR / f"{key}.mp3"
    if out_path.exists() and not force:
        print(f"  skip (exists): {key}.mp3")
        return
    print(f"  generating:   {key}.mp3")
    try:
        audio = client.text_to_speech.convert(
            voice_id=VOICE_ID,
            text=text,
            model_id='eleven_multilingual_v2',
            output_format='mp3_44100_128',
            voice_settings=VOICE_SETTINGS,
        )
        data = b''.join(audio) if hasattr(audio, '__iter__') and not isinstance(audio, (bytes, bytearray)) else audio
        out_path.write_bytes(data)
        print(f"  saved:        {out_path.name} ({len(data):,} bytes)")
    except Exception as e:
        print(f"  ERROR on {key}: {e}")


def main():
    force = '--force' in sys.argv
    if not API_KEY:
        print("ERROR: ELEVENLABS_API_KEY not set in .env")
        sys.exit(1)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    client = ElevenLabs(api_key=API_KEY)
    mode = "FORCE regenerate" if force else "Generating (skipping existing)"
    print(f"\n{mode}: {len(NPC_LINES)} NPC lines -> {OUT_DIR}\n")
    for key, text in NPC_LINES:
        generate_line(client, key, text, force=force)
    print("\nDone!")


if __name__ == '__main__':
    main()
