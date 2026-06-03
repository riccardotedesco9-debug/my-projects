# Phase 02 — Tool schema & contract

**Priority:** P0 — locks the API the turn handler exposes to Claude Sonnet.
**Status:** Pending
**Depends on:** phase 01 (classification complete).

## Design principles

1. **Fewer tools = better decisions.** ~8 is the sweet spot. More and the model wastes tokens deliberating which to call; fewer and it can't express what it needs.
2. **Reads over writes.** When in doubt, let the model re-read state, don't make it guess.
3. **Atomic actions.** Each tool does one thing. No "do_everything_for_session" meta-tools.
4. **Privacy by design.** Tools that touch another user's data (`find_user_by_name`) scope to "people this caller is already in session with or has person_notes for".
5. **Idempotent.** Calling the same tool twice with the same args is a no-op or deterministic.

## The 8 tools

### 1. `parse_schedule`

Run the vision/text schedule parser and return extracted shifts. Does NOT save.

```jsonc
{
  "name": "parse_schedule",
  "description": "Extract structured shifts from a schedule. Use this when the user sends a photo/PDF/voice-note/text of a work rota, calendar, or availability description. Returns the parsed shifts so you can inspect them before saving or asking the user to confirm. Either media_id OR text_content must be provided, never both.",
  "input_schema": {
    "type": "object",
    "properties": {
      "media_id":     { "type": "string", "description": "Telegram file_id from the current turn's attached media." },
      "mime_type":    { "type": "string" },
      "text_content": { "type": "string", "description": "Plain-text schedule description (if user typed it)." },
      "attributed_to_name": { "type": "string", "description": "If this schedule is for a specific named person (not the user), pass their display name. Parser uses this to scope extraction on multi-person rotas." }
    }
  }
}
```

Returns: `{ shifts: [{date, start_time, end_time, label?, confidence?}], detected_person_name?, date_range? }`.

### 2. `save_schedule`

Commit parsed shifts to the right owner. Call this after `parse_schedule` when the user has confirmed (or when confidence is high enough to skip explicit confirmation — turn handler's judgment).

```jsonc
{
  "name": "save_schedule",
  "description": "Save parsed shifts as a schedule. `owner` is either 'me' (user's own participant row), or a partner's chat_id if they're already a participant, or a person_name for someone the user uploaded a schedule on behalf of (stored in person_notes).",
  "input_schema": {
    "type": "object",
    "required": ["owner", "shifts"],
    "properties": {
      "owner": { "type": "string", "description": "'me' | chat_id | person_name" },
      "shifts": { "type": "array", "items": { "type": "object" } }
    }
  }
}
```

Returns: `{ saved: true, owner_resolved_to: "chat_id:123" | "person_note:Diego", shift_count: 12 }`.

### 3. `add_or_invite_partner`

One call to handle "I want to schedule with Alice" — looks Alice up by name or phone. If she's a known bot user → add as participant. If not → create a pending invite and return the deep link for the model to include in its reply.

```jsonc
{
  "name": "add_or_invite_partner",
  "description": "Find and add a partner to the current session. If they're a known bot user, adds them as a participant directly. If not, creates a pending invite and returns a deep link the user can share with them. Provide either name or phone.",
  "input_schema": {
    "type": "object",
    "properties": {
      "name":  { "type": "string" },
      "phone": { "type": "string" }
    }
  }
}
```

Returns:
- `{ added: true, partner_chat_id, partner_name }` if user exists
- `{ invited: true, invite_link: "https://t.me/..." }` if unknown
- `{ ambiguous: true, candidates: [{name, chat_id_suffix}] }` if multiple matches

### 4. `remove_partner`

```jsonc
{
  "name": "remove_partner",
  "description": "Remove a partner from the current session by name. Handles both real participants and pending invites. Returns ambiguous candidates if the name matches multiple people in the session.",
  "input_schema": {
    "type": "object",
    "required": ["name"],
    "properties": { "name": { "type": "string" } }
  }
}
```

Returns: `{ removed: true, name } | { ambiguous: true, candidates: [...] } | { not_found: true }`.

### 5. `compute_and_deliver_match`

Runs the match algorithm across all participants with schedules (including on-behalf schedules from person_notes), delivers the best slot as .ics + Google Calendar event + notification to every participant. Marks the session COMPLETED.

```jsonc
{
  "name": "compute_and_deliver_match",
  "description": "Compute overlapping free time across all participants (real + on-behalf) and deliver the best slot to everyone. Use when the user asks 'when are we all free?' or confirms they're ready to finalise. Returns the chosen slot or 'no_overlap'.",
  "input_schema": {
    "type": "object",
    "properties": {
      "force_mediated": { "type": "boolean", "description": "If true, skip mutual-preference gate and pick longest-window slot immediately. Used when the user wants an answer now without waiting for partner picks." }
    }
  }
}
```

Returns: `{ status: "delivered", slot: {...} } | { status: "no_overlap" } | { status: "need_more_schedules", missing: 2 }`.

### 6. `upsert_knowledge`

Dual-purpose: save facts about the user OR about a named person. One tool, discriminated by `target`.

```jsonc
{
  "name": "upsert_knowledge",
  "description": "Remember something for future conversations. `target='user'` saves to the user's own profile (name, language, timezone, or freeform fact). `target='person'` saves to a named third party's person_notes row (creates the row if absent).",
  "input_schema": {
    "type": "object",
    "required": ["target"],
    "properties": {
      "target": { "enum": ["user", "person"] },
      "person_name": { "type": "string", "description": "Required when target=person" },
      "name":     { "type": "string", "description": "User's display name" },
      "language": { "type": "string", "description": "ISO 639-1, e.g. 'it'" },
      "timezone": { "type": "string", "description": "IANA string, e.g. 'Europe/Rome'" },
      "phone":    { "type": "string" },
      "fact":     { "type": "string", "description": "Freeform note to append (300-char cap per call)" }
    }
  }
}
```

### 7. `session_action`

Create / cancel / reset actions on the session itself.

```jsonc
{
  "name": "session_action",
  "description": "Take an action on the current session. `new` starts a fresh session (expires any existing one). `cancel` marks it EXPIRED and notifies other participants. `reset_all` wipes all the user's data (confirmation gated by the turn handler — you only call this after the user has unambiguously confirmed).",
  "input_schema": {
    "type": "object",
    "required": ["action"],
    "properties": { "action": { "enum": ["new", "cancel", "reset_all"] } }
  }
}
```

### 8. `reply`

Terminal tool. When the model calls this, the loop exits and the text is sent to Telegram.

```jsonc
{
  "name": "reply",
  "description": "Send the user a reply and end the turn. This is ALWAYS the last tool call of a turn. Use `buttons` for yes/no confirmations so the user can one-tap. Use `messages` as an array for multi-message replies (e.g. acknowledgment + invite link).",
  "input_schema": {
    "type": "object",
    "properties": {
      "text":    { "type": "string" },
      "messages": { "type": "array", "items": { "type": "string" }, "description": "Alternative to text — list of separate messages to send in order." },
      "buttons": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["text", "callback"],
          "properties": {
            "text": { "type": "string" },
            "callback": { "enum": ["confirm", "reject", "yes", "no"] }
          }
        }
      }
    }
  }
}
```

## What we are NOT giving Claude a tool for

- **`get_state`** — state is ALREADY in the system prompt / user turn, refreshed at turn start. No tool needed. If the model wants fresher state (e.g. after several write tool calls) it can call `get_session_snapshot` — but we're leaving that OUT of v1 to force the model to trust the turn-start snapshot. Add in v2 if we observe the model wanting re-reads.
- **`send_typing_indicator`** — Telegram allows this but noise. Skip.
- **`read_pending_invites`** — already in snapshot.
- **`set_participant_state`** — state machine is gone. No tool.
- **`generate_invite_link`** — folded into `add_or_invite_partner` return value.

## Tool call loop semantics

- Max tool calls per turn: **6** (hard cap to prevent runaways).
- After each non-`reply` tool call, we feed the result back into the conversation and let the model go again.
- `reply` always ends the turn.
- If the model hits the cap without calling `reply`, fall back to a hardcoded "hmm, I need to think about that — can you say it differently?" message and log the incident as `session_events` event `turn_exceeded_tool_cap` for dashboard visibility.

## Unresolved questions

1. Do we expose a `fetch_url` / `search_web` tool for edge cases where the user asks "what's the best café in Valletta to meet"? **No, out of scope** — this is a scheduler, not a concierge. If we add it later, add it as a v2 tool.
2. Should tool inputs reject attempts to pass other users' chat_ids the caller has no session relationship with? **Yes** — wrap tool implementations with a `scopedToCaller(chatId)` check.
