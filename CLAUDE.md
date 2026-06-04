# CLAUDE.md — My Projects (Root)

This is the parent workspace containing all of Riccardo's projects.

## Project Structure

```
My Projects/
│   #  AGENTS — Claude Code skill/agent workspaces (the tooling that does the work)
├── agents/
│   ├── Engineering/   — engineering skills + agents + rules
│   ├── Marketing/     — marketing skills + agents + rules
│   ├── WebDesign/     — web design skills + agents + rules
│   └── WebScraper/    — scraping skills + agents + rules (Firecrawl MCP)
│   #  PROJECTS — all built/deployed work (one self-contained folder each; transient)
├── projects/
│   ├── meetsync/             — deployed Telegram scheduling bot (Cloudflare Worker + D1)
│   ├── trigger-automations/  — deployed Trigger.dev platform (meetsync / job-hunt / billing tasks)
│   ├── job-hunt/             — local arm of the job-digest automation
│   ├── <project>/            — websites, campaigns, simulators, docs … created/deleted freely
│   └── …                     — every NEW project goes here, any domain, each with its own CLAUDE.md
│   #  SHARED — config & tooling (stay at root)
├── tools/          — Shared scripts (secrets sync, billing) — resolve paths from repo root
├── plans/  docs/   — Shared workspace-level plans & docs
└── CLAUDE.md  .gitignore  .env.tpl   — root config
```

Two buckets, plus shared config. **`agents/`** holds the four Claude Code domain workspaces (`Engineering`, `Marketing`, `WebDesign`, `WebScraper`) — skill/agent/rule environments that reshape how I work when you enter them (the tooling). **`projects/`** holds **all built and deployed work**, one self-contained folder each with its own `CLAUDE.md` — including deployed apps like `meetsync/` and `trigger-automations/`. Shared tooling (`tools/`), `plans/`, `docs/`, and root config stay at the top level. Global rules/skills are the baseline everywhere; a project's own `CLAUDE.md` adds the specifics when you work inside it.

### Shared Directories

Projects may contain these common directories:

| Directory | Purpose | Lifecycle |
|---|---|---|
| `workflows/` | Markdown SOPs defining objectives, inputs, tools, outputs, edge cases | Persistent — evolve as you learn |
| `tools/` | Python scripts for deterministic execution (API calls, transforms, file ops) | Persistent — tested and versioned |
| `.tmp/` | Intermediate/scraped data, processing artifacts | Disposable — regenerated as needed |

Final deliverables go to cloud services (Google Drive, Sheets, etc.), not local files.

### Secrets — 1Password is the single source of truth (set up 2026-05-06)

All secrets across every project are managed from the **AI-Stack** 1Password vault. Per-project `.env` files still exist on disk as a **legacy fallback** — do NOT create new ones for new work; do NOT add new secrets to them.

**The flow:**

1. Real value lives in **1Password vault `AI-Stack`** (e.g. `op://AI-Stack/anthropic/api-key`).
2. **`.env.tpl`** (committed at workspace root) maps each var name → `op://` reference. Every secret in the workspace is listed here.
3. **`tools/secrets-manifest.json`** declares which platforms (Cloudflare Worker via wrangler, Trigger.dev via env-file import) each secret needs to reach.
4. **`tools/sync-secrets.mjs`** reads from 1P and pushes:
   - `--target=cloudflare-meetsync` → runs `wrangler secret put` for the MeetSync Worker
   - `--target=trigger-prod` → writes `.tmp/trigger-prod.env` you import via the Trigger.dev dashboard
   - No flag = both targets
5. **Local dev**: `op run --env-file=".env.tpl" -- <command>` injects secrets at runtime — never written to disk.

**When adding a new secret:**

1. Create the item in 1Password (item title + field name, all lowercase-kebab).
2. Add a row to `tools/secrets-manifest.json` with name, `opRef`, and target platforms.
3. Add a line to `.env.tpl`: `NAME=op://AI-Stack/<item>/<field>`.
4. Run `node tools/sync-secrets.mjs --target=<platform>` to push.
5. Code reads it via `process.env.NAME` as usual.

**Bootstrap helper** (one-time, populates the vault from existing `.env` files): `tools/bootstrap-1p-vault.mjs`.

**Do NOT:**
- Create per-project `.env.tpl` — single workspace template only.
- Commit real secret values anywhere.
- Add secrets to per-project `.env` for new work — go through 1P.
- `wrangler secret put` directly in production — always go through `sync-secrets.mjs` so 1P stays canonical.
- Tell users to "edit your `.env`" for new vars without also updating the manifest + `.env.tpl`.

**Gotcha cheatsheet:**
- `op item create ... id=<value>` silently drops the field (`id` is reserved). Use `password=<value>` or another name.
- Cloudflare API token permissions are immutable — to add a scope you create a new token, not edit.
- Anthropic Admin API keys are Team/Org-tier only — billing-pulse silent-skips on personal plans.

**Related memory:** `~/.claude/projects/C--Users-Riccardo-Documents-My-Projects/memory/project_billing-pulse.md` documents the billing pulse, `/internal/alert` Worker route, and more op-CLI gotchas.

## Agent Operating Model

You operate in a **Workflows → Agent → Tools** architecture. Workflows are markdown SOPs (the instructions), you are the agent (reasoning and orchestration), and tools are deterministic scripts (execution). This separation matters: probabilistic AI handles decisions while deterministic code handles execution, keeping accuracy high across multi-step tasks.

**Operating principles:**
1. **Existing tools first** — check `tools/` and MCP integrations before building anything new
2. **Fail forward** — when errors occur: read the full trace, fix the script, retest, then update the workflow so it doesn't recur. If a fix involves paid API calls or credits, confirm before retrying.
3. **Keep workflows current** — when you discover better methods, constraints, or recurring issues, update the relevant workflow. Don't create or overwrite workflows without asking unless explicitly told to.
4. **Self-improvement loop** — identify what broke → fix the tool → verify the fix → update the workflow → move on with a stronger system

## Skill Visibility

Full skill architecture is defined in `~/.claude/CLAUDE.md`. In this workspace:
Global is the **complete** at-reach library — engineer + marketing skills live in `~/.claude/skills` **and** every domain's subagents live in `~/.claude/agents` (campaign-manager, seo-specialist, funnel-architect, code-reviewer, planner…). So **every directory (root, projects/, any agents/ workspace) can use any tool *and* spawn any agent** (engineering *and* marketing). Progressive disclosure keeps it cheap: only one-line metadata is ever in context; skill/agent bodies load on demand.
- **Root / `projects/` / anywhere** → full global library (engineering + marketing skills, ~135).
- **agents/Engineering/** → global only (engineer kit lives globally; local kit removed 2026-06-04).
- **agents/Marketing/** → global skills (its local copies are overridden by global). Its marketing **subagents are global too** (`~/.claude/agents/`, reachable from anywhere); only its **`mkt:` commands** stay local to this folder.
- **agents/WebDesign/** → global + web design local skills (frontend-design, ui-ux-pro-max, web-design-guidelines — also present in global).
- **agents/WebScraper/** → global skills + Firecrawl MCP.

## Available MCP Integrations (Global)

These tools are available across ALL projects. Use them autonomously when the task warrants it — do not wait for the user to ask.

### Communication & Productivity
- **Gmail** (`mcp__claude_ai_Gmail__*`) — Search/read messages & threads, draft emails, list labels, get profile. Use for outreach, follow-ups, notifications.
- **Slack** (`mcp__claude_ai_Slack__*`) — Send/schedule messages, read channels & threads, search (public + private), create/read/update canvases, read user profiles. Use for team comms, updates, documentation.
- **Google Calendar** (`mcp__claude_ai_Google_Calendar__*`) — List/create/update/delete events, find meeting times across attendees, find free time, RSVP to invitations. Use for scheduling, meeting coordination.

### Documents & Storage
- **Google Drive** (`mcp__google-drive__*`) — Full CRUD for Google Docs, Sheets, Slides, and Drive files. Create/edit/format documents, spreadsheets (formulas, validation, conditional formatting, named ranges), and presentations (shapes, text boxes, speaker notes, backgrounds). Manage permissions, comments, revisions, folders, shortcuts. Upload/download files, convert PDFs to Docs. Also has calendar event access. Use for content calendars, reports, shared documents, data management. **Caveat:** in this environment the `mcp__google-drive__*` tools have hung indefinitely (even metadata-only calls like `authGetStatus`) — prefer the Google OAuth refresh-token fetch pattern in code, or ask the user to create/share the file and paste its ID. See memory `reference_google-drive-mcp-hangs.md`. (Does not apply to the separate `mcp__claude_ai_Google_Drive__*` connector.)

### Content & Design
- **Canva** (`mcp__claude_ai_Canva__*`) — Generate designs (AI-powered), create from candidates, edit via transactions (start → perform operations → commit), export in multiple formats, manage folders/assets, comment on designs, resize, search designs/folders, manage brand kits, import from URL. Use for visual content, social graphics, presentations.
- **Gamma** (`mcp__claude_ai_Gamma__*`) — Generate AI-powered presentations, documents, webpages, and social posts. Browse themes and folders. Note: can only create new content, cannot edit existing Gammas. Use for pitch decks, reports, landing pages.

### Visual Generation
- **fal.ai** (`mcp__fal-ai__*`) — Live catalog of 1000+ image, vector/SVG, video, and 3D generation models (FLUX, Recraft, Ideogram, Nano Banana, Kling/Veo/Wan, Trellis/Hunyuan3D, flux-lora, etc.). Use `recommend_model` / `search_models` / `get_pricing` to discover the best current model, `run_model` / `submit_job` / `check_job` to execute. **Do not call fal tools directly — activate the global `creative-router` skill first**, which decomposes intent, picks the live best-fit model, declares cost, and gates spend. Use for custom images, pixel/game art, vectors/SVG, video clips, 3D assets, niche/anime/LoRA styles.

### Voice, Audio & Sound Design
- **ElevenLabs** (`mcp__elevenlabs__*`) — Comprehensive audio platform:
  - **TTS**: Text-to-speech with 5+ models (multilingual, flash, turbo), voice selection, stability/style controls, speed adjustment, multiple output formats (MP3, PCM, WAV, Opus)
  - **Sound Effects**: Text-to-sound-effects generation (0.5–5 sec, loopable) — ideal for game SFX
  - **Music**: AI music composition from prompts or structured composition plans with sections, styles, and lyrics
  - **Voice Design**: Generate new voices from text descriptions, clone voices from audio samples, search public voice library (thousands of voices)
  - **Speech-to-Text**: Transcription with speaker diarization
  - **Voice Conversion**: Speech-to-speech voice transformation
  - **Audio Isolation**: Extract/clean vocals from audio files
  - **Conversational AI**: Create voice agents with custom prompts, knowledge bases, and phone call capabilities
  - **Playback**: Play audio files directly
  - Use as **primary tool for all sound design** — covers SFX, music, voices, and audio processing

### Web Scraping
- **Firecrawl** (`mcp__firecrawl__*`) — Full-site crawling, single-page scraping, site mapping, structured data extraction. Handles JS rendering, converts to clean markdown. Available in the `agents/WebScraper/` workspace. Use for competitor analysis, content audits, documentation ingestion, bulk data extraction.

### Automation
- **Trigger.dev** (`mcp__trigger__*`) — Deploy, trigger, and monitor TypeScript automation tasks. Use for background jobs, scheduled tasks, AI agent orchestration, data pipelines. Project lives in `projects/trigger-automations/`. **Before building or changing any automation, follow the conventions in `projects/trigger-automations/CLAUDE.md`** — the canonical builder guide (workflow order, `schedules.task` cron patterns, the 1Password secrets flow, deploy + failure-handling rules). All automations live in that one project, regardless of which other `projects/` project they serve.

### Infrastructure
- **Cloudflare** (`mcp__cloudflare__*`) — Query D1 databases, manage Workers, KV, R2, and 2500+ Cloudflare API endpoints. Use for ad-hoc D1 queries, Worker log inspection, and infrastructure management. MeetSync's database and webhook gateway run on Cloudflare.

### Developer Tooling
- **Context7** (`mcp__context7__*`) — Up-to-date library/framework documentation lookup (Upstash). Use for API docs, latest library features, version-specific references. Complements the `docs-seeker` skill.
- **Chrome DevTools** (`mcp__chrome-devtools__*`) — Browser automation, DOM inspection, network/performance profiling. Use for live UI debugging, Core Web Vitals checks, scripted browser flows.
- **Sequential Thinking** (`mcp__sequential-thinking__*`) — Structured step-by-step reasoning with revision. Use for complex multi-step analysis where the `sequential-thinking` skill is active.

## Tools-First Policy

**Resolution order:** MCP integrations → existing `tools/` scripts → existing `workflows/` SOPs → new code (last resort).

Always use available MCP tools before improvising code-based alternatives:

- **Email** → Gmail MCP, not manual drafting or script-based SMTP
- **Automation** → Trigger.dev tasks, not custom scripts or cron jobs
- **Audio/Sound** → ElevenLabs, not code-based audio generation
- **Scheduling** → Google Calendar, not manual tracking
- **Documents/Data** → Google Drive (Docs, Sheets, Slides), not local-only files when collaboration matters
- **Communication** → Slack, not ad-hoc notification scripts
- **Visual Content (templated/decks)** → Canva (templated brand graphics, resizes) or Gamma (decks/pages), not code-based HTML/CSS designs
- **Dynamic visual generation** (custom images, pixel/indie game art, vectors/SVG, video, 3D, niche/anime/trained styles) → fal.ai via the **`creative-router`** skill — NOT Canva/Gamma (those keep their lanes). See "Visual / Creative Routing" below.
- **File Storage** → Google Drive, not local temp files for shared assets
- **Web Scraping** → Firecrawl MCP (in agents/WebScraper/), not manual fetch loops or custom scrapers
- **Infrastructure** → Cloudflare MCP for D1 queries, Worker management; not raw HTTP API calls
- **Deterministic tasks** → `tools/` scripts, not inline AI reasoning for API calls, transforms, or file ops

Only fall back to new code when: MCP tool lacks a required capability, no existing script covers the task, the task is purely local/dev-only, or the user explicitly requests code.

**Usage guidelines:**
- **Proactively**: If a task clearly benefits from a tool, just use it.
- **Combine tools**: Chain tools for complex workflows (e.g., research → write content → design in Canva → schedule via Slack).
- **Ask when ambiguous**: Briefly confirm before executing external actions (sending emails, posting messages, creating events).
- **Deliverables to cloud**: Final outputs go to cloud services where the user can access them directly. Local files (`.tmp/`) are just for processing.

### Visual / Creative Routing

For any **dynamic visual generation** — custom images, pixel/indie game art, vectors/SVG, video, 3D assets, niche/anime/trained styles — fal.ai supplies the generation models and the global **`creative-router`** skill (`~/.claude/skills/creative-router/`) decides which model to use. It activates before any such request and runs a general procedure: decompose intent → search fal's **live** catalog (`fal-ai` MCP: `recommend_model` / `search_models` / `get_pricing`) for the best CURRENT model → **declare the model + estimated cost** → gate on spend → run → download to `.tmp/creative/` + log to a cost ledger. There is no frozen model list; selection happens live so new models are used automatically.

- **Keep existing lanes / precedence:** decks → Gamma, templated brand graphics/resizes → Canva, audio → ElevenLabs, analyze/OCR existing media → ai-multimodal, structured diagrams → Mermaid. `creative-router` defers to those first. **This block is the single source of truth for dynamic visual generation and supersedes** any older "generate via ai-multimodal / Imagen / Nano-Banana" wording found in skill descriptions or `development-rules` — those tools are for *analysis*, *curated specialty*, or **grandfathered Gemini pipelines invoked explicitly** (`logo-design`, `cip-design`, `video-production`, `ai-artist`). Any generic "make me a …" visual request routes through `creative-router`.
- **Cost discipline:** single images under $0.10 auto-fire; video, batches >4, 3D, LoRA training, or any ≥$0.10 image require a one-line OK first. fal is **prepaid** — keep a low balance as the spend cap.
- **Secret:** `FAL_KEY` canonical in 1Password (`op://AI-Stack/fal/password`, item title `fal`). For zero-prompt MCP auth it's also materialized once into the Windows user env (`setx FAL_KEY` sourced from 1P); the fal-ai MCP header uses `${FAL_KEY}`. A scoped, conscious exception to never-on-disk — acceptable because fal is prepaid (capped blast radius). Re-run the `setx` if the key rotates.

## Cross-Project Rules

- **Two buckets.** `agents/` holds the four Claude Code domain workspaces (`Engineering`, `Marketing`, `WebDesign`, `WebScraper`) — skill/agent/rule tooling only, no project folders inside. `projects/` holds **all built and deployed work** — one self-contained, kebab-case folder each (e.g. `projects/meetsync/`, `projects/pet-centre-mellieha/`), regardless of domain (engineering, marketing, web design, scraping, deployed apps, or cross-cutting). Don't create project folders at the workspace root or inside an `agents/` workspace.
- **Each project has its own `CLAUDE.md`** — global rules/skills are the baseline; the project's `CLAUDE.md` carries its stack, conventions, and specifics. Record the project's domain at the top, e.g. `Domain: Engineering` (or `Marketing` / `WebDesign` / `WebScraper` / `cross-cutting`), so the right agent workspace's local skills are obvious.
- **Skills**: global skills are available everywhere. Domain-specific local skills (`mkt:*`, engineering/web-design locals) load when you work *from* that agent workspace (`agents/<Domain>/`) — invoke them explicitly, or open the workspace, when a project needs them.
- Plans go in `projects/{name}/plans/`, docs in `projects/{name}/docs/`. The session hook runs in subdirectory mode and creates these in the current directory automatically — just work from inside the project folder.
- Only shared config (`CLAUDE.md`, `.gitignore`, `.env.tpl`), shared tooling (`tools/`, `plans/`, `docs/`), `agents/`, and `projects/` live at root — no loose files.
- **Workspace rules location**: `agents/{workspace}/.claude/rules/` is the canonical directory for per-workspace SOPs. Marketing's `.claude/workflows/` is grandfathered in but new ones should use `rules/`.
- **`projects/` contents are transient** — projects are created and deleted freely; **never hardcode a project's name or path** in new code/config. Projects are self-contained (relative paths), so deleting one breaks nothing. **Exception — the deploy-coupled trio** (`projects/meetsync/`, `projects/trigger-automations/`, `projects/job-hunt/`) IS referenced by shared tooling: `tools/secrets-manifest.json` points `cwd` at `projects/meetsync/worker`, and `tools/bootstrap-1p-vault.mjs` reads each one's `.env`. If you ever rename or move those three, update those two files (and the meetsync deploy commands in `projects/meetsync/CLAUDE.md`).
