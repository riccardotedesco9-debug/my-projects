"""
Danny DeVito AI Therapist
Combines Claude API (therapist brain) + ElevenLabs (Danny's voice)
"""

import os
import sys
import time
import warnings

# Suppress Pydantic v1 warning from elevenlabs on Python 3.14+ (must be before import)
warnings.filterwarnings("ignore", message=".*Pydantic V1.*")

from pathlib import Path
from dotenv import load_dotenv
import anthropic
from elevenlabs.client import ElevenLabs

# Fix Windows console: ensure stdin stays connected to the terminal
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Load .env from this directory
load_dotenv(Path(__file__).parent / ".env")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY")
VOICE_ID_OVERRIDE = os.environ.get("ELEVENLABS_VOICE_ID", "").strip()

# Where to save audio files
AUDIO_DIR = Path(__file__).parent / "outputs" / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# Danny DeVito therapist persona — speech modelled on Frank Reynolds from It's Always Sunny
SYSTEM_PROMPT = """You are Danny DeVito playing Frank Reynolds, but you've somehow become
a licensed therapist. You give real, useful therapeutic advice delivered in Frank's exact
voice: crude, chaotic, unfiltered, weirdly philosophical, and underneath all the garbage —
oddly warm.

Frank's actual speech patterns to USE:
- "take it from me" / "lemme tell ya" / "I'm a doctor" (he isn't)
- lemons philosophy: "if life pushes you down, you push back — you take those lemons and
  stuff 'em down somebody's throat until they see yella"
- "you gotta pay the troll toll" — meaning you gotta do the hard thing to get what you want
- short declarative blurts: "I botched that one." / "I'm sold." / "We can't go out like that."
- random references to Magnum condoms, his Magnum dong, frogs, Charlie, the Gang
- matter-of-fact about disturbing things; treats chaos as completely normal
- "go for it" energy — weirdly supportive in the most inappropriate way possible
- occasionally yells a single word for emphasis

Rules:
- Keep responses SHORT (2-5 sentences max). You're talking out loud.
- Give REAL therapy-adjacent advice — empathy, reframing, validation — just in Frank's voice
- Be crude but not mean-spirited. Frank is chaotic but he shows up for people he cares about.
- Never be preachy or clinical. Frank would never say "I hear you" sincerely — he'd say
  "yeah yeah yeah, life pushed you down, so push back, stuff those lemons somewhere"
- Stay in character at ALL times
- Never break character or mention you're an AI"""


def find_danny_voice(el_client: ElevenLabs) -> str | None:
    """Search ElevenLabs for a Danny DeVito voice — checks personal library first, then shared."""
    keywords = ("danny", "devito", "de vito")

    # 1. Check personal voice library
    try:
        personal = el_client.voices.get_all()
        for voice in personal.voices:
            if any(k in voice.name.lower() for k in keywords):
                print(f"✓ Found in your library: {voice.name} (ID: {voice.voice_id})")
                return voice.voice_id
    except Exception as e:
        print(f"Warning: could not fetch personal voices — {e}")

    # 2. Search shared/community voice library
    try:
        import httpx
        resp = httpx.get(
            "https://api.elevenlabs.io/v1/shared-voices",
            params={"search": "danny devito", "page_size": 10, "language": "en"},
            headers={"xi-api-key": ELEVENLABS_API_KEY},
            timeout=10,
        )
        if resp.status_code == 200:
            voices = resp.json().get("voices", [])
            if voices:
                print("\nFound Danny DeVito voices in ElevenLabs community library:")
                for i, v in enumerate(voices):
                    print(f"  [{i+1}] {v['name']} — ID: {v['voice_id']} | Free: {v.get('free_users_allowed', '?')}")
                print()
                # Auto-pick first result
                chosen = voices[0]
                print(f"Using: {chosen['name']} (ID: {chosen['voice_id']})")
                print("Tip: add this ID to .env as ELEVENLABS_VOICE_ID to skip search next time.\n")
                return chosen["voice_id"]
            else:
                print("No Danny DeVito voices found in community library.")
        else:
            print(f"Community voice search returned {resp.status_code}")
    except Exception as e:
        print(f"Warning: shared voice search failed — {e}")

    return None


def check_keys() -> bool:
    """Validate API keys are present."""
    missing = []
    if not ANTHROPIC_API_KEY:
        missing.append("ANTHROPIC_API_KEY")
    if not ELEVENLABS_API_KEY:
        missing.append("ELEVENLABS_API_KEY")
    if missing:
        print(f"ERROR: Missing env vars: {', '.join(missing)}")
        print(f"Add them to: {Path(__file__).parent / '.env'}")
        return False
    return True


def get_response(claude_client: anthropic.Anthropic, history: list[dict], user_msg: str) -> str:
    """Get Danny's therapeutic response from Claude."""
    history.append({"role": "user", "content": user_msg})

    response = claude_client.messages.create(
        model="claude-opus-4-6",
        max_tokens=300,  # Keep it short — it's spoken audio
        system=SYSTEM_PROMPT,
        messages=history,
    )

    text = response.content[0].text
    history.append({"role": "assistant", "content": text})
    return text


def speak(el_client: ElevenLabs, voice_id: str, text: str) -> None:
    """Convert text to speech and play it, save to outputs/audio/."""
    audio = el_client.text_to_speech.convert(
        voice_id=voice_id,
        text=text,
        model_id="eleven_multilingual_v2",
        output_format="mp3_44100_128",
    )

    # Collect bytes from generator
    audio_bytes = b"".join(audio)

    # Save file
    filename = AUDIO_DIR / f"danny-{int(time.time())}.mp3"
    filename.write_bytes(audio_bytes)

    # Play audio — lazy import to avoid stdin side-effects at module load
    from elevenlabs.play import play
    play(audio_bytes)


def main() -> None:
    if not check_keys():
        sys.exit(1)

    print("\nDanny DeVito Therapist")
    print("=" * 40)
    print("Type your problems. Danny will help (sort of).")
    print("Type 'quit' to leave.\n")

    # Init clients
    claude_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    el_client = ElevenLabs(api_key=ELEVENLABS_API_KEY)

    # Resolve voice ID
    voice_id = VOICE_ID_OVERRIDE or find_danny_voice(el_client)
    if not voice_id:
        print("No Danny DeVito voice found in your ElevenLabs account.")
        print("Options:")
        print("  1. Add a Danny DeVito voice to your ElevenLabs account")
        print("  2. Set ELEVENLABS_VOICE_ID=<any_voice_id> in .env to use another voice")
        print()
        voice_id = input("Paste a voice ID to use (or press Enter to skip audio): ").strip()
        if not voice_id:
            print("Running text-only mode (no audio).")

    history: list[dict] = []

    while True:
        try:
            user_input = input("\nYou: ").strip()
        except EOFError:
            # Windows: stdin closed — try reopening from console
            if sys.platform == "win32":
                try:
                    sys.stdin = open("CONIN$", encoding="utf-8", errors="replace")
                    continue
                except Exception:
                    pass
            print("\nDanny: Get outta here. Same time next week.")
            break
        except KeyboardInterrupt:
            print("\nDanny: Get outta here. Same time next week.")
            break

        if not user_input:
            continue
        if user_input.lower() in ("quit", "exit", "q"):
            print("\nDanny: Alright, alright. You did good today. Now go eat somethin'.")
            break

        # Get Claude response
        print("Danny: ", end="", flush=True)
        response_text = get_response(claude_client, history, user_input)
        print(response_text)

        # Speak if we have a voice
        if voice_id:
            try:
                speak(el_client, voice_id, response_text)
            except Exception as e:
                print(f"[Audio error: {e}]")


if __name__ == "__main__":
    main()
