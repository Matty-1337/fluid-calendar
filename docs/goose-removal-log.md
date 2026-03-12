# Goose Removal Log — FluidCalendar

**Date:** 2025-03-07

---

## Actions Taken (Repo)

| File path | Action | Reason |
|-----------|--------|--------|
| (none) | No files deleted or edited | No Goose-related files exist in the repo. See goose-config-audit.md. |

**Backup:** Not applicable; no repo files were removed.

---

## What Was Found

- **Repo:** Zero Goose references. No `.goose/` directory, no goose config files, no scripts or docs mentioning Goose.
- **Cursor user rules:** A rule named **goose-workflow.mdc** (or with description referencing "Goose CLI" / "Architect vs Builder") is applied as a **user-level** rule. It is not stored inside this repository.

---

## Manual Step Required: Remove Goose User Rule in Cursor

The Goose workflow rule is part of Cursor’s user (or workspace) configuration. To remove it:

### Option A — Cursor Settings UI (recommended)

1. Open **Cursor Settings**
   - Windows/Linux: `File` → `Preferences` → `Cursor Settings`, or `Ctrl+Shift+J`
   - Or click the gear icon and choose the Cursor-specific settings.
2. Go to the **Rules** (or **Rules for AI**) section.
3. Find the rule that describes the Goose workflow (e.g. "Enforces the Architect/Builder split between Cursor and Goose CLI" or path `.cursor/rules/goose-workflow.mdc`).
4. Remove or disable that rule (delete/trash or toggle off, depending on the UI).
5. Save if prompted. The rule will no longer be injected into new chats.

### Option B — User rules file (if Cursor stores rules as files)

Cursor may store user rules in a file under your user profile or Cursor config directory, for example:

- Windows: `%USERPROFILE%\.cursor\` or under `AppData\Roaming\Cursor\`
- Look for a `rules` folder or a config file that lists rule paths (e.g. `goose-workflow.mdc`).

If you find a file that defines or references the Goose rule:

1. Open it in an editor.
2. Remove the Goose rule entry or the entire `goose-workflow.mdc` file if it exists there.
3. Save and restart Cursor if needed.

**Note:** Exact paths can vary by Cursor version. If the Rules UI does not show a "file" path, use Option A.

---

## Verification After Removal

- Start a new Cursor chat in this repo and ask the AI to run a simple shell command (e.g. `git status`). If the Goose rule is removed, the AI should be able to run the command (or offer to) instead of only outputting a "Delegate to Goose" block.
- No verification is needed inside the repo itself; no repo files were changed for Goose removal.
