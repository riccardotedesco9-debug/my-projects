# CLAUDE.md -- WebDesign Workspace

Frontend web design domain — holds web design **skills, agents, and workflow rules** (plus shared tooling like `serve.mjs`/`screenshot.mjs`), not project folders. This workspace lives under `agents/`. Build polished, production-grade websites from reference designs, screenshots, or from scratch. Actual design projects live in the workspace-root `../../projects/` folder, each with its own `CLAUDE.md`.

## Build Modes

This workspace runs in **two modes** — pick by the task:

1. **Quick Design Mode (default):** a single polished `index.html` + Tailwind CDN — landing pages, mockups, one-pagers, reference replication. **Every rule below** (Output Defaults, Anti-Generic Guardrails, single-file, "no frameworks beyond Tailwind") applies to THIS mode.
2. **Web Studio Mode:** composable builds for **any production site or web-app** — marketing site, blog, content site, web-app, or storefront — that the owner visually tweaks, AI-agent-driven, with managed add-on modules (chatbot, email, booking, reviews, and **commerce only when the project sells**). **Universal spine = Builder.io**; storefronts add the commerce branch (**Shopify headless + Hydrogen/Oxygen**); non-commerce sites publish Builder.io to Cloudflare Pages / Vercel. NOT single-file HTML. See **[`.claude/rules/web-studio-recipe.md`](.claude/rules/web-studio-recipe.md)** for the stack, the repeatable new-site procedure, MCP/secrets wiring, and the security model. The single-file Output Defaults below **do NOT apply** in this mode.

**Security invariant (BOTH modes, non-negotiable):** never hand-build or AI-build anything security-critical — payments, checkout, card data, account auth. Route each to a certified managed service (Shopify PCI L1, Stripe, vendor DPAs). AI owns only the presentation layer.

## Always Do First

**Invoke the `frontend-design` skill** before writing any frontend code, every session, no exceptions.

## Recommended Skills (auto-invoke when relevant)

- `frontend-design` — mandatory before any frontend code (already above)
- `ui-ux-pro-max` — for design system decisions, color palettes, typography
- `chrome-devtools` — for screenshots, visual comparison, performance testing
- `/fix` — when CSS/layout breaks or behaves unexpectedly
- `ai-multimodal` — for analyzing reference images and screenshots in detail

## Reference Image Workflow

- If a reference image is provided: match layout, spacing, typography, and color exactly. Swap in placeholder content (images via `https://placehold.co/`, generic copy). Do not improve or add to the design.
- If no reference image: design from scratch with high craft (see guardrails below).
- Use `ai-multimodal` skill to analyze reference images in detail.
- Screenshot your output, compare against reference, fix mismatches, re-screenshot. Do at least 2 comparison rounds. Stop only when no visible differences remain or user says so.
- When comparing, be specific: "heading is 32px but reference shows ~24px", "card gap is 16px but should be 24px".
- Check: spacing/padding, font size/weight/line-height, colors (exact hex), alignment, border-radius, shadows, image sizing.

## Local Server

- **Always serve on localhost** -- never screenshot a `file:///` URL.
- Start the dev server: `node serve.mjs` (serves project root at `http://localhost:3000`).
- `serve.mjs` lives in the workspace root. Start it in the background before taking any screenshots.
- If the server is already running, do not start a second instance.

## Screenshot Workflow

- Use `chrome-devtools` skill for browser automation and screenshots.
- Run: `node screenshot.mjs http://localhost:3000 [label]`
- Screenshots auto-increment in `./temporary-screenshots/` (e.g., `screenshot-1.png`, `screenshot-2-hero.png`).
- After screenshotting, read the PNG with the Read tool -- Claude can analyze the image directly.

## Output Defaults

- Single `index.html` file, all styles inline, unless user says otherwise.
- Tailwind CSS via CDN: `<script src="https://cdn.tailwindcss.com"></script>`
- Placeholder images: `https://placehold.co/WIDTHxHEIGHT`
- Google Fonts for typography (never default to Inter/Arial).
- Mobile-first responsive.

## Brand Assets

- Always check the `brand_assets/` folder before designing.
- If assets exist there (logos, color guides, style guides, images), use them.
- Do not use placeholders where real assets are available.
- If a color palette is defined, use those exact values -- do not invent brand colors.

## Anti-Generic Guardrails

- **Colors**: Never use default Tailwind palette (indigo-500, blue-600, etc.). Pick a custom brand color and derive from it.
- **Shadows**: Never use flat `shadow-md`. Use layered, color-tinted shadows with low opacity.
- **Typography**: Never use the same font for headings and body. Pair a display/serif with a clean sans. Apply tight tracking (`-0.03em`) on large headings, generous line-height (`1.7`) on body.
- **Gradients**: Layer multiple radial gradients. Add grain/texture via SVG noise filter for depth.
- **Animations**: Only animate `transform` and `opacity`. Never `transition-all`. Use spring-style easing.
- **Interactive states**: Every clickable element needs hover, focus-visible, and active states. No exceptions.
- **Images**: Add a gradient overlay (`bg-gradient-to-t from-black/60`) and a color treatment layer with `mix-blend-multiply`.
- **Spacing**: Use intentional, consistent spacing tokens -- not random Tailwind steps.
- **Depth**: Surfaces should have a layering system (base -> elevated -> floating), not all sit at the same z-plane.

## Hard Rules

- Do not add sections, features, or content not in the reference.
- Do not "improve" a reference design -- match it.
- Do not stop after one screenshot pass.
- Do not use `transition-all`.
- Do not use default Tailwind blue/indigo as primary color.
- No frameworks beyond Tailwind unless explicitly requested.

## Local Skills (`./.claude/skills/`)

WebDesign-specific (global skills inherited automatically):
frontend-design, ui-ux-pro-max, web-design-guidelines

## Relevant Global Skills

Inherited automatically:
- **chrome-devtools** -- Screenshots, browser automation, performance analysis
- **ai-multimodal** -- Analyze reference images, verify implementations, describe/OCR existing media (analysis only — NOT generation)
- **media-processing** -- Image manipulation, background removal, format conversion
- **creative-router** -- Dynamic image / vector-SVG / video / 3D generation via fal.ai (custom hero images, icons, illustrations). Activate before any "generate an image/visual" request that isn't analyzing an existing asset.

## Available Global Integrations

- **Google Drive** -- Save completed designs, share with clients
- **Canva** -- Generate design assets, brand materials, social graphics
- **Gamma** -- Quick AI-generated presentations, landing pages, mockups
- **fal.ai** (via `creative-router` skill) -- Generate custom raster images, vector/SVG icons & illustrations, short video clips, and 3D assets when no Canva template fits. The skill selects the model and states cost before running.

## Structure Rules

- **New design projects go in the workspace-level `../../projects/` folder** -- one self-contained folder each, never inside `WebDesign/`. This workspace holds skills/agents/rules + shared tooling only.
- Folder name: descriptive, kebab-case (e.g., `../../projects/client-landing-page/`).
- Each folder is self-contained (HTML, CSS, JS, assets, screenshots) and gets its own `CLAUDE.md` noting `Domain: WebDesign` so these web design skills/agents are the obvious choice when working inside it.

## Documentation

Keep docs in `./docs/`, plans in `./plans/`.
