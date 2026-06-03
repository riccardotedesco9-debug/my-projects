# projects/

Home for **all deliverable work projects** in this workspace. One self-contained folder per project — flat, kebab-case.

This is deliberately separate from two things that stay at the workspace root: the **agents** (the `Engineering/`, `Marketing/`, `WebDesign/`, `WebScraper/` Claude Code skill/agent workspaces) and **deployed apps** (live, infra-coupled products like `meetsync/`). Projects = bounded deliverable work; agents = the tooling that does the work; deployed apps = running products you can't relocate without breaking their deploy wiring.

## Conventions

- **Flat layout** — every project sits directly here (`projects/<name>/`), regardless of domain. No nesting by domain.
- **Kebab-case** folder names, descriptive (e.g. `client-landing-page/`, `q2-email-campaign/`, `pet-centre-mellieha/`).
- **Each project is self-contained** — its own code/assets, plus its own `docs/` and `plans/` (the session hook creates these in the current directory automatically when you work from inside the folder).
- **Each project has its own `CLAUDE.md`** — global rules/skills are the baseline; the project's `CLAUDE.md` carries its stack, conventions, and specifics. Put a `Domain:` line at the top so the right local skills/agents are obvious:

  ```
  # CLAUDE.md — <Project Name>

  Domain: Engineering        # or Marketing / WebDesign / WebScraper / cross-cutting
  ```

- **Domain skills**: global skills work everywhere. Domain-specific local skills (`mkt:*`, engineering/web-design locals) load when you work *from* that domain workspace — invoke them explicitly, or open the workspace, when a project needs them.

## Already moved here (2026-06-03)

`pixel-life/` (from `Engineering/`), `pet-centre-mellieha/`, `job-application/` (from root).

## Staying outside `projects/`

Coupled to live infra, so they stay put: `job-hunt/` (root) and `Engineering/trigger-automations/` are the local/deploy arms of Trigger.dev automations (`bootstrap-1p-vault.mjs` reads `job-hunt/.env`; trigger-automations hosts the deployed tasks). `meetsync/` stays at root permanently — it's a **deployed app** (live Worker + D1), not a bounded project.
