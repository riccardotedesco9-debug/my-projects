# projects/

Home for **all deliverable work projects** in this workspace. One self-contained folder per project — flat, kebab-case.

This is deliberately separate from **`agents/`** — the sibling folder holding the four Claude Code skill/agent workspaces (`Engineering`, `Marketing`, `WebDesign`, `WebScraper`). Projects = the built and deployed work (including deployed apps like `meetsync/` and `trigger-automations/`); agents = the tooling that does the work.

## Conventions

- **Flat layout** — every project sits directly here (`projects/<name>/`), regardless of domain. No nesting by domain.
- **Kebab-case** folder names, descriptive (e.g. `client-landing-page/`, `q2-email-campaign/`, `pet-centre-marketing/`).
- **Each project is self-contained** — its own code/assets, plus its own `docs/` and `plans/` (the session hook creates these in the current directory automatically when you work from inside the folder).
- **Each project has its own `CLAUDE.md`** — global rules/skills are the baseline; the project's `CLAUDE.md` carries its stack, conventions, and specifics. Put a `Domain:` line at the top so the right local skills/agents are obvious:

  ```
  # CLAUDE.md — <Project Name>

  Domain: Engineering        # or Marketing / WebDesign / WebScraper / cross-cutting
  ```

- **Domain skills**: global skills work everywhere. Domain-specific local skills (`mkt:*`, engineering/web-design locals) load when you work *from* that domain workspace — invoke them explicitly, or open the workspace, when a project needs them.

## Contents are transient

Projects here are created and deleted freely. **Don't hardcode any project's name or path** anywhere (code, config, scripts, docs) — whatever sits here today may be gone tomorrow. Each project is self-contained (relative paths), so deleting one breaks nothing else. The *convention* is stable; the *contents* are not.

## Deploy-coupled projects (don't rename without rewiring)

Most projects here come and go freely. **Two are referenced by shared tooling**, so renaming/moving them means updating those refs too:
- `meetsync/` — `tools/secrets-manifest.json` points wrangler at `projects/meetsync/worker`; deploy commands live in `meetsync/CLAUDE.md`.
- `trigger-automations/` — the deployed Trigger.dev platform (runs the meetsync / billing tasks). meetsync's deploy copies it from the sibling `../trigger-automations`.

Everything else in `projects/` is transient (see above).
