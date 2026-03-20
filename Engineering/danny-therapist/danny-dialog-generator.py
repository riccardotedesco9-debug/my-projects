"""
danny-dialog-generator.py
Generates ElevenLabs MP3 audio for all Danny DeVito dialog lines in the pixel game.
Output: game/assets/audio/danny-{scene}-{n}.mp3

Usage:
  python danny-dialog-generator.py           # skip existing files
  python danny-dialog-generator.py --force   # regenerate all

Requirements:
  pip install elevenlabs python-dotenv
  .env must contain ELEVENLABS_API_KEY and optionally ELEVENLABS_VOICE_ID
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from elevenlabs import ElevenLabs
from elevenlabs.types import VoiceSettings

# ── Config ────────────────────────────────────────────────────────────────────
load_dotenv()
API_KEY  = os.getenv('ELEVENLABS_API_KEY')
VOICE_ID = os.getenv('ELEVENLABS_VOICE_ID')  # leave blank to auto-search
OUT_DIR  = Path(__file__).parent / 'game' / 'assets' / 'audio'

# Voice settings — tuned for unhinged Frank Reynolds energy
# stability: lower = more expressive/varied delivery
# style: exaggerates emotional style
# similarity_boost: how closely to match the voice clone
VOICE_SETTINGS = VoiceSettings(
    stability=0.30,
    similarity_boost=0.82,
    style=0.50,
    use_speaker_boost=True,
)

# All Danny lines: (audio_key, text)
DANNY_LINES = [
    # Scene 1 — Asbury Park
    ('danny-asbury-0', "Ma, I'm gonna be famous. Bigger than this whole street. And when I am, I'm comin' back here and buyin' the whole block. Every house. Every tree. Bulldozed. Out of love."),
    ('danny-asbury-1', "You know what, I wrote that down. I got a little book. And one day I'm gonna be on every TV in America, and you're gonna be nobody. That's not a threat. That's just what's gonna happen."),
    ('danny-asbury-2', "Sal, I got plans that would make your head spin. SCHEMES, Sal. Big ones. Probably illegal. But definitely profitable. You wanna be part of something? Because I'm about to do something great."),

    # Scene 2 — Beauty School
    ('danny-beauty-0', "Professor, I'll tell you how. I just pretend every head of hair is a character and I'm telling their story. Also I've been upcharging for the back of the head and pocketing the difference. You didn't hear that."),
    ('danny-beauty-1', "Gloria, baby, I gave you beautiful hair and I am PROUD of that. But I gotta go. I got a calling. I'm gonna be in movies, or TV, or SOMETHING. I can feel it in my whole body. Also I need forty bucks for acting school."),
    ('danny-beauty-2', "Pete, you son of a bitch. I'm in. I'm going to acting school. Well, Monday — they're closed today. But MONDAY I walk in there and I take what's mine. Also I'm finishing your hair. I'm a professional."),

    # Scene 3 — Taxi Depot
    ('danny-taxi-0', "Five years I played that man. FIVE YEARS. And I loved every horrible second of it. Louie De Palma is a monster and he is my masterpiece. God help me, he is my masterpiece."),
    ('danny-taxi-1', "Alex, Louie is the most honest character I ever played. He wants what he wants and he doesn't pretend otherwise. Most people lie about who they are. Not Louie. Also the pretzels in that cage were incredible. Real perk of the job."),
    ('danny-taxi-2', "Jim, that might be the most profound thing anyone has ever said to me. Also yes. Get the sandwich. The sandwich is always the answer. Don't let anyone tell you otherwise. Life is short. Eat the sandwich."),

    # Scene 4 — Gotham City
    ('danny-gotham-0', "Tim, I AM the Penguin. Not in a performance sense. In a SPIRITUAL sense. That character lives inside me. He's been in there my whole life. The fish was my idea. The biting was my idea. You're welcome, cinema."),
    ('danny-gotham-1', "Three hours of makeup EVERY MORNING. Every. Single. Morning. Four AM. In a chair. Being transformed into a monster. And I LOVED it. The fish were real. All the fish. Method doesn't even begin to cover it."),
    ('danny-gotham-2', "Baby, I love you. You are the only human being who truly understands what I'm doing. The kids will get it when they're older. Or they won't. Either way I am PROUD of that movie and I would do it again tomorrow."),

    # Scene 5 — Paddy's Pub
    ('danny-paddys-0', "Charlie, I love ya buddy but you are a walking disaster and I say that as a man who once negotiated with actual sewer rats. Now listen up: I got a plan. It's probably illegal in four states. Let's go."),
    ('danny-paddys-1', "MAC. God sees everything. He sees your karate. He is not impressed. I say that with love. Now get out of my way, I got a scheme and you're either in or you're out, and trust me you want to be IN."),
    ('danny-paddys-2', "Dennis. My boy. My possibly-son. You are a golden god, I know that. But even golden gods need a wild card. And I AM the wild card. WILDCARD, Dennis. Now sit down and listen to your father. Or whoever I am to you. It's still not totally clear."),
    ('danny-paddys-3', "Dee. Bird. Sweetheart. I believe in you, I always have. That's not the issue. The issue is it IS a bird food commercial and I need you to know that before you get too excited. You'd be great in it. Very natural."),
]


def find_danny_voice(client):
    """Search for Danny DeVito voice in the user's ElevenLabs library."""
    try:
        voices = client.voices.get_all()
        for v in voices.voices:
            if 'danny' in v.name.lower() or 'devito' in v.name.lower():
                print(f"Found voice: {v.name} ({v.voice_id})")
                return v.voice_id
    except Exception as e:
        print(f"Warning: could not search voices -- {e}")
    return None


def generate_line(client, voice_id, key, text, force=False):
    out_path = OUT_DIR / f"{key}.mp3"
    if out_path.exists() and not force:
        print(f"  skip (exists): {key}.mp3")
        return

    print(f"  generating:   {key}.mp3")
    try:
        audio = client.text_to_speech.convert(
            voice_id=voice_id,
            text=text,
            model_id='eleven_multilingual_v2',
            output_format='mp3_44100_128',
            voice_settings=VOICE_SETTINGS,
        )
        # audio may be bytes or a generator
        if hasattr(audio, '__iter__') and not isinstance(audio, (bytes, bytearray)):
            data = b''.join(audio)
        else:
            data = audio

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

    voice_id = VOICE_ID
    if not voice_id:
        print("ELEVENLABS_VOICE_ID not set -- searching for Danny voice...")
        voice_id = find_danny_voice(client)
    if not voice_id:
        print("ERROR: Could not find a Danny DeVito voice. Set ELEVENLABS_VOICE_ID in .env.")
        sys.exit(1)

    mode = "FORCE regenerate" if force else "Generating (skipping existing)"
    print(f"\n{mode}: {len(DANNY_LINES)} lines -> {OUT_DIR}\n")
    for key, text in DANNY_LINES:
        generate_line(client, voice_id, key, text, force=force)

    print("\nDone! Serve the game with:")
    print("  python -m http.server 8000   (from the game/ directory)")


if __name__ == '__main__':
    main()
