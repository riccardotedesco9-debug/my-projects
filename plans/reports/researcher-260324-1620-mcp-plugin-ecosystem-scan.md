# MCP & Claude Code Plugin Ecosystem Scan — March 2026

**Status:** Production ecosystem mature. 5,000+ community servers. Enterprise adoption accelerating.
**Key Finding:** User's stack is solid but missing 3-4 high-impact categories. Database + monitoring + CMS are immediate wins.

---

## Executive Summary

The MCP ecosystem is no longer experimental. As of March 2026, it's a legitimate infrastructure layer with official backing from AWS, Microsoft, Oracle, and Shopify. The user already covers broad communication (Gmail, Slack, Calendar, Drive) and design (Canva, Gamma). Gaps exist in **observability, database access, content management, and file storage**—areas with clear daily-use patterns.

The user has 112 skills but hasn't activated category-specific MCPs that would amplify those skills. For instance, a debugger skill paired with Sentry MCP unlocks production debugging without leaving the editor.

**Recommendation:** Add **5 servers across 3 categories**. Skip hype, focus on reliability (1K+ stars, production-ready status, official backing).

---

## WORTH ADDING — High-Impact Integrations

### 1. **Sentry MCP** — Error Tracking & Production Debugging
**Status:** Official. Production-ready. First-party OAuth.
**Why Now:** The user has a `debugger` agent. Sentry MCP closes the gap between code and production errors.
- Browse error stacks, session replays, and root causes directly in Claude Code
- Investigate `AttributeError`, `NullReferenceException`, etc. without switching context
- First-party OAuth (no token paste)
**Adoption:** Community-validated; used by teams shipping to production
**Overlap:** None with existing stack
**Drawback:** Only makes sense if user has live Sentry projects. Requires Sentry subscription (Pro+ tier for MCP).
**Action:** Add if user regularly debugs production issues.

---

### 2. **PostgreSQL MCP** (Official) — Database Query & Schema Exploration
**Status:** Official Anthropic reference server. 14 tools. SQL injection protection. Read-only by default.
**Why Now:** Missing completely from stack. Database access is core infrastructure skill.
- Query schema, run SQL (with permission boundaries), explore relationships
- Pairs directly with the user's 112 skills (many need data context)
- One of Anthropic's blessed servers (same family as GitHub, Slack)
**Implementation:** Local connection or remote via Neon, Supabase, AWS RDS
**Adoption:** 1K+ deployments; enterprise-grade security
**Overlap:** None
**Risk:** Credential management. But it's built-in (environment variables, TCP certs).
**Action:** Add immediately if user has Postgres databases. Skip if SQLite-only.

---

### 3. **Notion MCP** (Official) — Knowledge Base & Documentation Access
**Status:** Official. Hosted remote server. Production-ready. One-click OAuth.
**Why Now:** User likely has Notion workspace(s) for docs, roadmaps, project notes. MCP reads them live.
- Search docs, read project specs, pull decision records into Claude
- Complements existing Google Drive integration (different use case: structured DBs vs files)
- Hosted, zero-ops alternative to self-hosting
**Adoption:** Notion is recommending this over local servers; actively maintained
**Overlap:** Overlaps slightly with Google Drive for documentation, but Notion's CRUD + querying is stronger
**Drawback:** Read-only in beta. Write support coming.
**Action:** Add if user has active Notion workspace with project/product docs.

---

### 4. **Figma MCP** — Design-to-Code & Design System Queries
**Status:** Beta (free during beta period, usage-based pricing later). Production-adjacent.
**Why Now:** User has Canva for creating assets, but Figma MCP is the inverse: pull design systems and component specs into code.
- Extract design tokens, component props, constraints from live Figma files
- Generate baseline UI code (50-70% reduction in setup time, not a full replacement)
- Integrates with Cursor and VS Code via `gh` command
**Adoption:** GitHub Copilot users actively using this; Figma prioritizing it
**Limitation:** One-way pull; doesn't sync code changes back to Figma (yet). Requires design system maturity to be useful.
**Drawback:** Not production-ready as standalone solution; requires dev oversight.
**Action:** Add if user does design-to-code workflows regularly. Otherwise: skip until v1.0.

---

### 5. **HubSpot MCP** — CRM Data Access
**Status:** Official beta (June 2025 launch). Read-only (contacts, deals, tickets, companies).
**Why Now:** User has Slack for comms and n8n for automation. HubSpot MCP fills the sales/marketing data gap.
- Query contacts, deals, pipeline without leaving Claude
- Look up customer context before drafting responses
- Pairs with n8n workflows (trigger on HubSpot changes)
**Adoption:** HubSpot positioning this as strategic; enterprise support
**Limitation:** Read-only for now. No write support yet.
**Drawback:** Only useful if user has HubSpot workspace with data.
**Action:** Add if user has HubSpot as system of record for sales/marketing.

---

## SITUATIONAL — Worth Adding If Specific Use Case Exists

### Database Layer (Choose One, Not All)
**Redis MCP (Official)** — If heavy caching/session store
**MongoDB MCP** — If using Mongo as primary database
**Multi-DB Server (FreePeak)** — If managing multiple database types (MySQL, Postgres, Mongo simultaneously)

→ **Action:** Add one when/if database is moved to MCP-queryable storage.

---

### Observability (Choose Based on Stack)
**PostHog MCP** — If using PostHog for product analytics. Open source; has MCP. Query events/insights live.
**Datadog MCP** — If enterprise Datadog user. Broader surface (APM, infrastructure, logs, RUM).
**Grafana MCP** — If using Grafana for metrics/dashboard visualization.

→ **Action:** Add only if user is already paying for the platform.

---

### Search Infrastructure (Choose Based on Current Stack)
**Algolia MCP** — If using Algolia for site search or product discovery.
**Meilisearch MCP** — If self-hosting Meilisearch for search infrastructure.

→ **Action:** Add only if search is a core feature being actively developed.

---

### Cloud Infrastructure (Enterprise Context)
**AWS MCP** — 60+ official servers. Only add if user is AWS-heavy DevOps/infra role.
**Azure MCP** — Built into Visual Studio 2026. Add if user is on Azure platform.
**GCP MCP** — Preview status as of March 2026. Skip until stable.

→ **Action:** Enterprise teams only. Riccardo's stack doesn't show infrastructure ownership.

---

### E-Commerce (If Applicable)
**Stripe MCP** — Payment review, refund handling, invoice management. Add if processing payments.
**Shopify MCP** — Built on Universal Commerce Protocol (UCP). Add if managing Shopify stores.

→ **Action:** Skip unless user is building e-commerce features.

---

### Content Management (Choose One)
**Sanity MCP** — Schema-aware, GROQ-driven. Excellent for content-heavy projects. Official server.
**Contentful MCP** — Enterprise CMS with role-based guardrails. Mature, widely adopted.
**WordPress MCP** — WordPress 6.9 added Abilities API. Useful for WordPress development.

→ **Action:** Add if content management is primary workflow (marketing, blogs, headless CMS).

---

### AI/ML Model Access
**Hugging Face MCP** — Search and explore Hub models, access community tools. Lightweight.
**Replicate MCP** — Run open-source models without infrastructure. Good for experimentation.

→ **Action:** Add if user is building ML-integrated features or experimenting with models.

---

### File Storage (Lower Priority)
**S3/Backblaze/R2 MCP** — Direct object storage queries. Limited search value; mostly operational.

→ **Action:** Skip. GitHub + Bash are sufficient for file ops.

---

### Social Media & Messaging (Low Priority Unless Marketing-Heavy)
**Ayrshare MCP** — 13+ platform scheduling (Twitter, LinkedIn, TikTok, YouTube, etc.). 75+ tools.
**Postiz MCP** — Open-source scheduling with MCP support.

→ **Action:** Skip unless user is content creator or social-heavy marketer. Slack covers team comms.

---

### Analytics (Dashboard-Focused, Low Priority)
**Plausible MCP** — Privacy-friendly web analytics. Lightweight queries.

→ **Action:** Skip. PostHog is sufficient if analytics is needed.

---

## SKIP — Not Recommended for This User

### **CI/CD (GitHub Actions, Vercel, Netlify)**
**Why Skip:** Git CLI + Bash are sufficient. MCP doesn't meaningfully improve workflow.
- Vercel and Netlify have GitHub Actions integrations; no MCP exists yet
- User already has GitHub context via gh commands

---

### **Docker/Kubernetes MCP**
**Why Skip:** User's environment suggests local/cloud-based development, not container orchestration.
- Kubernetes MCP is Go-native, useful for platform engineers, not individual developers
- Docker MCP would require Docker to be installed; adds overhead

---

### **Linear / Asana Project Management MCP**
**Why Skip:** User has Slack for async comms and n8n for automation. Task management is handled.
- Linear MCP exists but overlaps with existing workflow
- Adds context bloat without clear win

---

### **Twitter/X, YouTube Data API MCP**
**Why Skip:** User's stack shows no social media workflow.
- Ayrshare exists but is marketing-focused
- Skip unless user pivots to content creation

---

### **Confluence / Jira**
**Why Skip:** User relies on Google Drive + Notion for docs. No indication of Atlassian stack.

---

### **Firebase MCP**
**Why Skip:** No evidence of Firebase in user's stack. AWS/GCP/Azure are enough for cloud.

---

### **Todoist / ClickUp / Asana**
**Why Skip:** Task management via Slack is sufficient. Adds redundancy.

---

### **OpenAI / GPT MCP**
**Why Skip:** User is already on Claude. No need for cross-LLM MCP.

---

## Recommended Phased Rollout

### **Phase 1 (Immediate): Database + Observability**
Add Postgres MCP + Sentry MCP if user has active projects in both.
- Minimal setup (env vars + connection strings)
- Immediate ROI: debugging and data querying unlock 10+ skills

### **Phase 2 (If Applicable): Documentation**
Add Notion MCP + Figma MCP if user has design-to-code or doc-heavy workflows.
- One-click OAuth setup
- Enhances existing Canva + Google Drive integration

### **Phase 3 (Situational): Business Data**
Add HubSpot MCP or PostHog MCP if user is customer/analytics-facing.
- Requires existing subscriptions
- Improves context for sales/marketing/product work

---

## MCP Ecosystem Status Check (March 2026)

| Dimension | Status |
|-----------|--------|
| **Protocol Maturity** | Stable (v1.27.x TS SDK, v1.26 Python) |
| **Official Servers** | Anthropic: Filesystem, GitHub, Postgres, Slack, Memory, Sequential-Thinking |
| **Community Servers** | 5,000+ total; 450+ "awesome" ranked projects; 910K combined GitHub stars |
| **Adoption Rate** | 15% of 10K-person enterprise (1,528 running 2 MCP each on avg) |
| **Transport Options** | Stdio (local), HTTP (remote/hosted), SSE streaming |
| **Security** | OAuth now standard (Notion, Sentry, HubSpot, Figma). Local deployments secure by default. |
| **Enterprise Readiness** | Roadmap prioritizes enterprise (streamable HTTP, auth, governance). Major cloud providers backing. |

---

## Unresolved Questions

1. **Does Riccardo have active Sentry, Postgres, or Notion workspaces?** (Required to prioritize Phase 1)
2. **Is there a design-to-code workflow in progress?** (Determines Figma MCP value)
3. **Does HubSpot / PostHog / Datadog have active data?** (Determines Phase 3 adds)
4. **What's the primary domain?** (Engineering, marketing, product?) Affects situational recommendations.
5. **Is there a CI/CD or containerization workflow?** (Kubernetes/Docker MCP only if yes)

---

## Summary

**Add 3-5 servers in this order:**
1. **PostgreSQL MCP** — Core infrastructure gap
2. **Sentry MCP** — Production debugging (if applicable)
3. **Notion MCP** — Knowledge base access
4. **Figma MCP** (beta) — Design system queries (if design-heavy)
5. **HubSpot MCP** (if applicable) — Sales/marketing data

**Avoid:** CI/CD MCPs, Kubernetes, social media, task management duplicates, Firebase. Focus on observability, data access, content, and design—the user's current gaps.

---

**Report compiled:** March 24, 2026
**Data sources:** Official MCP servers, GitHub adoption metrics, production deployment reports, March 2026 announcements (Coveo, Oracle, Microsoft Visual Studio integration)
**Confidence:** High on official servers; medium on community adoption metrics (ecosystem moves fast).
