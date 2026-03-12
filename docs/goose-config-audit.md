# Goose Config Audit — FluidCalendar

**Date:** 2025-03-07  
**Scope:** This repo and Cursor project/user configuration affecting it.

---

## Summary

- **Repo-level:** No Goose-related files, scripts, or references were found anywhere in the FluidCalendar project directory.
- **User-level:** A Cursor rule named `goose-workflow.mdc` is applied as a **user rule** (alwaysApply). It is not stored inside this repo; it is part of Cursor’s user/global configuration and must be removed from Cursor’s Rules settings if you want to stop Goose workflow behavior in this (and other) projects.

---

## Repo-Level Audit

### Files and Directories Searched

| What | Result |
|------|--------|
| `.goose/` directory | Not present |
| Files matching `*goose*` | None |
| Grep for "goose", "Goose", "GOOSE" in repo | No matches in any file |
| `.cursorrules` | Not present |
| `.cursor/` in repo | Present: contains only `rules/main-rule.mdc` |

### Repo `.cursor/rules/main-rule.mdc`

- **Purpose:** Upstream FluidCalendar development rules (Motion-style app, Next.js/Prisma/shadcn conventions, SAAS vs open source, logging, Prisma usage, etc.).
- **Goose:** No mention of Goose. Safe to keep as-is.
- **Action:** None. Do not remove or alter for Goose cleanup.

### Other Repo Config

- No `.goose/` directory.
- No goose-related YAML, JSON, TOML, or MD config files in the repo.
- No package.json scripts referencing Goose.
- No CI/workflow files (e.g. GitHub Actions) referencing Goose.
- No MCP or other config files in the repo that mention Goose.

**Conclusion:** No Goose-related project files exist in this repo. Nothing in the repo needs to be deleted or edited for Goose cleanup.

---

## User-Level / Cursor Configuration

### Where the Goose Rule Comes From

- In Cursor chats, a **user rule** is injected with description "Enforces the Architect/Builder split between Cursor and Goose CLI" and path `.cursor/rules/goose-workflow.mdc`.
- Inside **this repo**, the path `.cursor/rules/goose-workflow.mdc` does **not** exist. The only file under `.cursor/rules/` is `main-rule.mdc`.
- Therefore the Goose rule is **not** coming from the FluidCalendar repo. It is coming from Cursor’s **user-level** (or workspace-level) rules, which can live in:
  - Cursor Settings → Rules (or “Rules for AI”),
  - Or a rules directory that Cursor uses for the user/workspace (e.g. under your user profile or Cursor config), not under this repo.

### What the Goose Rule Does

- Instructs the AI to act as “Architect” and delegate execution (e.g. shell, migrations) to “Goose CLI” via “Goose Instruction Blocks.”
- Tells the AI not to run complex shell commands directly and to output blocks for the user to paste into Goose.
- Can affect behavior in **all** projects where Cursor is used, not only FluidCalendar.

### Is It Safe to Remove?

- **Yes.** Removing it only stops Cursor from applying that workflow. It does not delete any repo code or config. The FluidCalendar repo has no dependency on Goose.

### Project-Only vs Machine-Level

- The rule is **machine-/user-level** (or workspace-level): it is not stored in the FluidCalendar repo, so it applies across projects (or to the workspace) until you remove it in Cursor settings.

### Dependencies That Might Break If Removed

- **None** for this repo. The FluidCalendar project does not reference Goose anywhere. No scripts or docs depend on the Goose workflow.

---

## Audit Conclusion

| Location | Goose-related item | Safe to remove? | How |
|----------|--------------------|-----------------|-----|
| Repo | None found | N/A | N/A |
| Cursor user/global rules | `goose-workflow.mdc` rule | Yes | Remove via Cursor Settings → Rules (see goose-removal-log.md) |

No deletions or edits are required inside the FluidCalendar repo for Goose cleanup. The only required action is to remove the Goose user rule in Cursor if you no longer want that behavior.
