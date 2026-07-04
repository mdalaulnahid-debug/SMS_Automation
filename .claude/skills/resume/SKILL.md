---
name: resume
description: Session resume / catch-up for the SMS Automation project. Use at the start of a new session, or whenever the user types /resume, to get oriented fast and cheaply — reads only the project's status .md files (not the codebase) and returns a short review of the current state plus a prioritized plan for what to do next.
user-invocable: true
argument-hint: "[optional focus, e.g. 'migration' | 'design' | 'admin' | 'backend']"
---

# /resume — session catch-up

Orient on the **SMS Automation** project quickly and cheaply, then hand back a
short review plus a prioritized next-step plan. This skill exists to make session
resumes token-efficient: **read only the files listed in Step 1 — do NOT scan,
grep, or read the source code.** That restraint is the whole point.

## Step 1 — Read the status docs (only these)

Read these in order; skip any that don't exist:

1. `SESSION_MEMORY.md` — project map: what it is, the four surfaces, auth model,
   deploy/VPS rules, current design system, conventions/gotchas.
2. `progress_tracker.md` — the **"Current Stage"** block and the **newest**
   "Session Handoff" section (they're newest-first). Ignore older handoffs unless
   the user asks.
3. `todo.md` — the top **🔜 PLANNED** section and **Open follow-ups** (with their
   `P1`/`P2`/`P3` priorities). Skip the older `✅ RESOLVED` history unless asked.
4. If the user passed a focus argument, also skim the one matching doc:
   - `design` → `docs/design-system.md`
   - `migration` → the React+Vite plan in `todo.md` / `progress_tracker.md`
   - `backend` → `docs/PHONE_GATEWAY_CONTRACT.md`, `docs/telegram-bridge.md`
   - `admin` / other → the relevant section of the docs above (still no source files)

**Never read source files here.** For a specific "where / how does X work" code
question, run `graphify query "<question>"` (the prebuilt code graph) instead of
reading files — it returns the exact `file:line` for a fraction of the tokens.

## Step 2 — Cheap state check (optional, one command each)

Only if it adds signal; otherwise skip:
- `git status --short --untracked-files=no` and `git log --oneline -3`
- Do **not** run VPS / SSH / health checks unless the user asks or a deploy is
  clearly implied.

## Step 3 — Respond short (aim < 250 words)

Structure the reply as:

- **Where things stand** — 2–4 lines: what the project is (1 line), what shipped
  most recently, and live-deploy + git-sync status.
- **Pending decisions** — anything blocking progress (e.g. the React-migration
  stack choices: TS+Tailwind vs JS/plain-CSS; shadcn or not; confirm `web/`).
- **Suggested next steps** — the top 2–3 open items by priority (`P1` first), one
  line each, and call out the single best "start here" recommendation.
- End by asking which the user wants to tackle, or to confirm the recommended one.

## Rules

- **Be concise.** This is orientation, not a report — don't paste whole files back.
- **Prioritize by the `P1`/`P2`/`P3` ratings** already in `todo.md`.
- **Review only — never start work or edit files from this skill.** Propose, then
  wait for the user to choose.
- If a status doc contradicts the actual code or live state, flag it and trust the
  code — the docs are point-in-time notes.
