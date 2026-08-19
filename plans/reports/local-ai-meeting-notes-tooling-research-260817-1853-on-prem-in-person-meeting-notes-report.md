# On Premises AI Meeting Notes for In Person Meetings (Windows)

**TLDR**
Meetily is the answer for a fully local Windows app that records a room, transcribes and summarises with nothing leaving the machine. MIT licensed, real Windows installers, Whisper/Parakeet locally, Ollama for summaries. Two catches: speaker labelling ("who said what") is a paid Pro feature at $10/user/month, and the repo has slowed since June 2026. Second finding: Teams DOES handle in person meetings now via the mobile app plus the Facilitator agent, so the assumption that Teams needs a Teams call is out of date. That path needs a Microsoft 365 Copilot licence and sends audio to Microsoft's cloud, which for an org already on M365 is arguably in house, not third party. Hyprnote is out: renamed to Anarlog, macOS and Linux only, and the original domain now points at a private beta cloud product.

Date: 2026-08-17 | Researched via WebSearch/WebFetch/gh (Firecrawl 402, out of credits)

---

## 1. Requirement as stated

- In person meeting, people around a desk, recorder sitting in the background.
- Transcribe, summarise, surface key points and actions.
- No third party processing. On premises, own device, or self hosted.
- Org is Microsoft Office based.
- n8n acceptable as glue if no single product fits.

## 2. Hardware constraint (measured on this machine)

| Item | Value | Consequence |
|---|---|---|
| CPU | i7-13620H, 10 cores / 16 threads | Good CPU inference, workable |
| RAM | 31.6 GB | Fine for 8B class local LLM |
| GPU | Intel UHD (integrated), 2 GB | **No CUDA.** GPU acceleration paths are out |

Implication: use Parakeet or a small/medium Whisper model, not large-v3. Use an 8B class model in Ollama for summaries. Expect summaries in minutes, not seconds. Live real time transcription of a long meeting on CPU only is the risk area; record then process is the safe mode.

## 3. Candidates evaluated

| Tool | Windows | Room audio | Local STT | Local summary | Licence | Status | Verdict |
|---|---|---|---|---|---|---|---|
| **Meetily** | Yes, .exe + .msi | Yes, mic + system | Whisper / Parakeet | Ollama | MIT | 29.3k stars, v0.4.0 2026-06-05 | **Primary pick** |
| OpenWhispr | Yes | Partial | Whisper / Parakeet | Weak | MIT | 5.5k stars, active today | Dictation lane, not meetings |
| Anarlog (ex Hyprnote) | **No** | Yes | Parakeet | Ollama / LM Studio | MIT | 9.1k stars, active today | Ruled out, no Windows |
| Minutes | **No**, macOS | Yes | whisper.cpp + pyannote | Yes | MIT | 1.4k stars, active today | Best design, wrong OS |
| Scriberr | Docker | No, upload only | Whisper.cpp | Ollama | MIT | Maintainer paused | Batch fallback only |
| Vibe / Whishper / WhisperX | Mixed | No, files only | Yes | None | MIT / BSD | Active | Transcription only |
| Prismical | Claimed | Claimed | Claimed | Claimed | Unclear | No repo found | Unverified, do not rely on |
| Teams + Facilitator | Yes, mobile | Yes | Microsoft cloud | Microsoft cloud | Commercial | Shipping | Viable if M365 counts as in house |

### Key verification notes

- **Hyprnote is gone as a name.** `github.com/fastrepl/hyprnote` now resolves to `fastrepl/anarlog`. Repo alive (pushed 2026-08-17) but release assets are `.dmg`, `.deb`, `.AppImage` only. `hyprnote.com` 301s to `char.com`, a private beta cloud "AI Chief of Staff" with proposed $12/$24/$39 tiers. Classic local first project whose company moved to cloud. Worth noting as a vendor risk pattern, not a reason to distrust the MIT code.
- **Meetily diarization is Pro.** Community Edition gives local transcription and basic summaries. Speaker identification, custom templates, PDF/DOCX export and Windows GPU acceleration are Pro at $10/user/month billed annually, $25 monthly. Vendor states diarization runs on device. For a table of several people, speaker labels are close to essential, so budget for it.
- **Meetily pace has slowed.** Releases Feb, Mar, Jun 2026; nothing since 2026-06-05. Not abandoned, but not the daily cadence Anarlog and Minutes show. Mitigation: MIT licence, so the code cannot be taken away.
- **Teams in person is real.** Microsoft Teams mobile app plus the Facilitator agent takes notes in live in person meetings. Requires a Microsoft 365 Copilot licence. Audio and transcript go to Microsoft's cloud, inside the customer's own tenant. Loop file generation for notes ends 2026-07-31, no impact on live notes.

## 4. Recommendation

**Path A, fully local, no third party at all: Meetily.**
Install the Windows .msi, install Ollama with an 8B class model, set transcription to Parakeet. Nothing leaves the machine. Add Pro only if speaker labelling is needed. Cost: zero, or $10/user/month for Pro.

**Path B, path of least resistance if the objection is really about AI startups rather than cloud: Teams mobile + Facilitator.**
Their data is already in Microsoft's cloud under an existing DPA. No new vendor, no new hardware, no maintenance. Cost: M365 Copilot licence per user. Ask them directly which objection they actually hold, because it changes the answer completely.

**Path C, backup glue if neither app satisfies: n8n self hosted.**
Official n8n template exists for Whisper transcription plus Ollama summarisation. Record on any device, drop the file in a watched folder, n8n runs local Whisper then a local LLM, writes markdown out. More moving parts, total control, no per seat fee.

**Notes storage in all three cases:** land the output as markdown in an Obsidian vault. Local Whisper plugins exist for dictation inside the vault (Speech Kit, Voice Scribe, Whipscribe) if quick voice notes are also wanted.

## 5. Non software factors that decide success

1. **Microphone.** A laptop mic across a boardroom table produces audio Whisper mangles, and a summary built on a bad transcript is worse than no summary. A USB boundary/conference mic in the middle of the table is the highest return purchase in the project.
2. **Consent.** Recording people in a room in the EU. Announce it. This is the actual legal exposure, not the storage location.
3. **Backups.** Self hosting makes confidentiality better and durability worse. Encrypted offsite backup, or the privacy win becomes a data loss story.

## 6. Unresolved questions

- Is the objection "no cloud at all" or "no third party AI vendor"? If the latter, Teams plus Copilot wins on effort and Path A is unnecessary.
- How many users? Meetily Pro is per seat; n8n self hosted is not.
- Whose machine hosts it: this laptop, or a shared box/NAS on their premises? No CUDA here, so a shared machine with an NVIDIA card would change model choices considerably.
- Is speaker labelling a hard requirement, or is a single undifferentiated transcript acceptable?
- Prismical could not be verified. No GitHub repo found. Excluded rather than recommended blind.
