# CLAUDE.md — My Projects (Root)

This is the parent workspace containing all of Riccardo's projects.

## Project Structure

```
My Projects/
│   #  AGENTS — Claude Code skill/agent workspaces (stay at root)
├── Engineering/    — Domain workspace: engineering skills + agents + rules
├── Marketing/      — Domain workspace: marketing skills + agents + rules
├── WebDesign/      — Domain workspace: web design skills + agents + rules
├── WebScraper/     — Domain workspace: scraping skills + agents + rules (Firecrawl MCP)
│   #  DEPLOYED APPS — live products, infra-coupled (stay at root, not in projects/)
├── meetsync/       — Deployed product: WhatsApp/Telegram scheduling bot (Worker + D1)
│   #  PROJECTS — deliverable work (one self-contained folder each)
├── projects/       — All work projects live here (flat, kebab-case, each with its own CLAUDE.md)
│   ├── <project>/              — e.g. a website, campaign, simulator, or strategy doc
│   └── …                       — contents are transient (created/deleted freely); every NEW project goes here, any domain
│   #  SHARED — config & tooling
├── tools/          — Shared workspace tooling (secrets sync, billing, etc.)
├── plans/  docs/   — Shared workspace-level plans & docs
└── CLAUDE.md       — This file (global context)
```

Root holds three kinds of things. **Agents** — the four domain workspaces (`Engineering/`, `Marketing/`, `WebDesign/`, `WebScraper/`) — are Claude Code skill/agent/rule environments that reshape how I work when you enter them; they stay at root. **Deployed apps** — live, infra-coupled products like `meetsync/` (Cloudflare Worker + D1) — also stay at root, because moving them would break their deploy wiring. **Projects** — all bounded deliverable work — live in `projects/`, one self-contained folder each with its own `CLAUDE.md`. Global rules/skills are the baseline everywhere; a project's own `CLAUDE.md` adds the specifics when you work inside it. (A few existing projects are still grandfathered at root or inside `Engineering/` — see Cross-Project Rules.)

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
- **Root directory** → global skills only
- **Engineering/** → global + engineering local skills
- **Marketing/** → global + marketing local skills
- **WebDesign/** → global + web design local skills (frontend-design, ui-ux-pro-max, web-design-guidelines)
- **WebScraper/** → global skills + Firecrawl MCP
- **meetsync/** → global skills + Cloudflare MCP + Trigger.dev MCP (bot gateway + DB)

## Available MCP Integrations (Global)

These tools are available across ALL projects. Use them autonomously when the task warrants it — do not wait for the user to ask.

### Communication & Productivity
- **Gmail** (`mcp__claude_ai_Gmail__*`) — Search/read messages & threads, draft emails, list labels, get profile. Use for outreach, follow-ups, notifications.
- **Slack** (`mcp__claude_ai_Slack__*`) — Send/schedule messages, read channels & threads, search (public + private), create/read/update canvases, read user profiles. Use for team comms, updates, documentation.
- **Google Calendar** (`mcp__claude_ai_Google_Calendar__*`) — List/create/update/delete events, find meeting times across attendees, find free time, RSVP to invitations. Use for scheduling, meeting coordination.

### Documents & Storage
- **Google Drive** (`mcp__google-drive__*`) — Full CRUD for Google Docs, Sheets, Slides, and Drive files. Create/edit/format documents, spreadsheets (formulas, validation, conditional formatting, named ranges), and presentations (shapes, text boxes, speaker notes, backgrounds). Manage permissions, comments, revisions, folders, shortcuts. Upload/download files, convert PDFs to Docs. Also has calendar event access. Use for content calendars, reports, shared documents, data management.

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
- **Firecrawl** (`mcp__firecrawl__*`) — Full-site crawling, single-page scraping, site mapping, structured data extraction. Handles JS rendering, converts to clean markdown. Available in `WebScraper/` workspace. Use for competitor analysis, content audits, documentation ingestion, bulk data extraction.

### Automation
- **Trigger.dev** (`mcp__trigger__*`) — Deploy, trigger, and monitor TypeScript automation tasks. Use for background jobs, scheduled tasks, AI agent orchestration, data pipelines. Project lives in `Engineering/trigger-automations/`. **Before building or changing any automation, follow the conventions in `Engineering/trigger-automations/CLAUDE.md`** — the canonical builder guide (workflow order, `schedules.task` cron patterns, the 1Password secrets flow, deploy + failure-handling rules). All automations live in that one project, regardless of which `projects/` project they serve.

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
- **Web Scraping** → Firecrawl MCP (in WebScraper/), not manual fetch loops or custom scrapers
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

- **All work projects live in `projects/`** — one self-contained, kebab-case folder each (e.g. `projects/pet-centre-mellieha/`). This applies to **every** project regardless of domain — engineering, marketing, web design, scraping, or cross-cutting. Do **not** create project folders at the workspace root or inside the domain workspaces.
- **Agents & deployed apps stay at root, not in `projects/`.** The four domain workspaces (`Engineering/`, `Marketing/`, `WebDesign/`, `WebScraper/`) are Claude Code skill/agent/rule environments (the "agents"). Deployed apps like `meetsync/` (live Worker + D1) are infra-coupled running products. Both stay at root and are **not** subject to the `projects/` rule — `projects/` is for bounded deliverable work only.
- **Each project has its own `CLAUDE.md`** — global rules/skills are the baseline; the project's `CLAUDE.md` carries its stack, conventions, and specifics. Record the project's domain at the top, e.g. `Domain: Engineering` (or `Marketing` / `WebDesign` / `WebScraper` / `cross-cutting`), so the right local skills/agents are obvious when working inside it.
- **Skills**: global skills are available everywhere. Domain-specific local skills (`mkt:*`, engineering/web-design locals) load when you work *from* that domain workspace — invoke them explicitly, or open the workspace, when a project needs them.
- Plans go in `projects/{name}/plans/`, docs in `projects/{name}/docs/`. The session hook runs in subdirectory mode and creates these in the current directory automatically — just work from inside the project folder.
- Only shared config (CLAUDE.md, .gitignore), shared tooling (`tools/`, `plans/`, `docs/`), the agents (four domain workspaces), deployed apps (`meetsync/`), and `projects/` live at root — no loose files.
- **Workspace rules location**: `{project}/.claude/rules/` is the canonical directory for per-project workflow SOPs (matches Engineering pattern). Marketing's `.claude/workflows/` is grandfathered in but new projects should use `rules/`.
- **`projects/` contents are transient** — projects are created and deleted freely; **never hardcode a project's name or path** elsewhere (code, config, scripts, docs). The convention is stable, the contents are not. Projects are self-contained (relative paths), so deleting one breaks nothing.
- **Structurally stable, outside `projects/`**: `meetsync/` is the long-term keeper — a **deployed app** at root, never moved. `job-hunt/` (root) and `Engineering/trigger-automations/` stay put *while they exist* — they're the local/deploy arms of Trigger.dev automations (`tools/bootstrap-1p-vault.mjs` reads `job-hunt/.env`; `trigger-automations/` hosts the deployed tasks), so relocate them only if you also rewire those references. All **new** projects start in `projects/`.
