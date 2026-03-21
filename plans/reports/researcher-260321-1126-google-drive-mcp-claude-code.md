# Research: Google Drive MCP Setup for Claude Code CLI

**Date:** 2026-03-21 | **Status:** Complete | **Scope:** MCP configuration, remote vs local integration, setup steps

---

## Key Findings

### 1. Remote MCP vs Claude Code CLI Integration

**Are claude.ai remote MCPs shared with Claude Code?**
NO. They are completely separate:

- **claude.ai web app**: Remote MCP integrations (Gmail, Slack, Calendar, etc.) run on Anthropic-managed cloud infrastructure. Users authenticate once via OAuth—no local setup needed.
- **Claude Code CLI**: Uses LOCAL configuration only. Remote MCP is still available but requires explicit HTTP-based registration. Integrations from the web app do NOT automatically sync to the CLI.

**What this means:** Remote MCP servers in claude.ai (e.g., Gmail, Slack) cannot be automatically used in Claude Code CLI. Each tool must be independently configured.

---

### 2. Official Google Drive MCP Status

**Is there an official Google Drive MCP server?**
PARTIALLY. Anthropic archived the official Google Drive MCP server on May 29, 2025.

- **Official source:** [modelcontextprotocol/servers-archived](https://github.com/modelcontextprotocol/servers-archived/tree/main/src/gdrive) — read-only, no longer maintained.
- **NPX package:** `@modelcontextprotocol/server-gdrive` exists but sourced from the archived code.
- **Recommendation:** Use maintained community implementations instead. The most reliable is [piotr-agier/google-drive-mcp](https://github.com/piotr-agier/google-drive-mcp), which supports Claude Desktop and Claude Code.

---

### 3. Claude Code MCP Configuration Methods

Claude Code supports two config approaches:

**A. CLI-based (Interactive)**
```bash
claude mcp add --transport stdio google-drive -- npx @piotr-agier/google-drive-mcp
```
Config stored in `~/.claude.json` by default (local scope).

**B. Direct file editing (Recommended)**
Edit `~/.claude.json` directly for complex setups with environment variables and auth paths. Location options:
- `~/.claude.json` — Global (user scope)
- `.mcp.json` — Project-scoped (committed to repo)

**Config format:**
```json
{
  "mcpServers": {
    "google-drive": {
      "type": "stdio",
      "command": "npx",
      "args": ["@piotr-agier/google-drive-mcp"],
      "env": {
        "GOOGLE_DRIVE_OAUTH_CREDENTIALS": "/path/to/gcp-oauth.keys.json"
      }
    }
  }
}
```

---

## Setup Steps: Google Drive MCP for Claude Code

### Prerequisites
- Google Cloud project with Drive API enabled
- OAuth 2.0 Desktop credentials (JSON file)

### Step 1: Google Cloud OAuth Setup
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project
3. Enable these APIs:
   - Google Drive API
   - Google Docs API
   - Google Sheets API
   - Google Slides API
   - Google Calendar API (optional)
4. Configure OAuth Consent Screen (internal mode works for testing)
5. Create OAuth 2.0 credentials (type: Desktop app)
6. Download JSON and save as `gcp-oauth.keys.json`

### Step 2: Store Credentials
Save the OAuth file in one of these locations (priority order):
1. `~/.config/google-drive-mcp/gcp-oauth.keys.json` (Recommended)
2. `GOOGLE_DRIVE_OAUTH_CREDENTIALS` environment variable
3. `./gcp-oauth.keys.json` (project root)

### Step 3: Add to Claude Code
**Option A: CLI method**
```bash
claude mcp add --transport stdio google-drive -- npx @piotr-agier/google-drive-mcp
```

**Option B: Direct file edit (with env var)**
Edit `~/.claude.json`:
```json
{
  "mcpServers": {
    "google-drive": {
      "type": "stdio",
      "command": "npx",
      "args": ["@piotr-agier/google-drive-mcp"],
      "env": {
        "GOOGLE_DRIVE_OAUTH_CREDENTIALS": "/path/to/gcp-oauth.keys.json"
      }
    }
  }
}
```

### Step 4: Verify Setup
```bash
claude mcp list
```
Should show `google-drive` in the output.

### Step 5: First Run Authentication
On first use, the server automatically opens a browser for OAuth authentication. Grant access to Google Drive, and credentials are saved.

---

## Alternative Community Implementations

If piotr-agier/google-drive-mcp doesn't meet your needs:

| Project | Language | Features | Setup Complexity |
|---------|----------|----------|------------------|
| [isaacphi/mcp-gdrive](https://github.com/isaacphi/mcp-gdrive) | Node.js | Drive + Sheets (read/write) | Medium |
| [a-bonus/google-docs-mcp](https://github.com/a-bonus/google-docs-mcp) | Node.js | Docs + Sheets + Drive (full edit) | Medium |
| [felores/gdrive-mcp-server](https://github.com/felores/gdrive-mcp-server) | Node.js | Efficient Drive access | Low |
| [AojdevStudio/gdrive](https://github.com/AojdevStudio/gdrive) | Node.js | Production-ready | Medium |

---

## Important Differences: Remote vs Local MCP

| Aspect | Remote MCP | Local MCP (Claude Code) |
|--------|-----------|------------------------|
| **Architecture** | HTTP server (Anthropic-managed) | stdio process on your machine |
| **Config location** | Not applicable (automatic in claude.ai) | `~/.claude.json` or `.mcp.json` |
| **Setup** | Browser OAuth flow | Local OAuth + credential file |
| **Latency** | Network dependent | Direct (faster) |
| **Failures** | Vendor-managed | Your responsibility |
| **Availability across CLI/Web** | NO—separate | NO—each needs own config |

---

## Unresolved Questions

1. **Future official Google Drive MCP:** Will Anthropic maintain a Google Drive MCP server? No public roadmap found. Community forks are stable but dependent on maintainers.

2. **OAuth persistence:** Do saved credentials persist across Claude Code sessions without manual re-auth? Documentation claims automatic, but no field reports found to confirm.

3. **piotr-agier/google-drive-mcp maintenance status:** Is this the community's long-term standard? No formal endorsement from Anthropic found, but it's the most referenced in docs and guides.

4. **Remote MCP for Google Drive:** Will Anthropic add Google Drive as a remote MCP option (like Gmail/Slack)? Not announced; would be convenience improvement.

---

## Sources

- [Claude Code Docs — Connect Code to Tools via MCP](https://code.claude.com/docs/en/mcp)
- [Model Context Protocol — Official Servers](https://github.com/modelcontextprotocol/servers)
- [Archived Google Drive MCP](https://github.com/modelcontextprotocol/servers-archived/tree/main/src/gdrive)
- [piotr-agier/google-drive-mcp](https://github.com/piotr-agier/google-drive-mcp)
- [GitHub MCP Server — Claude Code Installation Guide](https://github.com/github/github-mcp-server/blob/main/docs/installation-guides/install-claude.md)
- [Scott Spence — Configuring MCP Tools in Claude Code](https://scottspence.com/posts/configuring-mcp-tools-in-claude-code)
- [MCPcat — Adding MCP Servers to Claude Code](https://mcpcat.io/guides/adding-an-mcp-server-to-claude-code/)
- [TrueFoundry — MCP Authentication in Claude Code 2026](https://www.truefoundry.com/blog/mcp-authentication-in-claude-code)
- [Builder.io — Claude Code MCP Integration](https://www.builder.io/blog/claude-code-mcp-servers)
