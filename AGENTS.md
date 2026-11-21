## Agent skills

Follow `CONTRIBUTING.md`: ADR drafts are welcome before team discussion; a merged
ADR means the team has discussed and agreed on the decision. Keep ADR references within
the introducing branch and PR until the ADR is on remote `master`; see
`docs/agents/issue-tracker.md`.

### Issue tracker

Issues live in GitHub Issues for herr-ek/csk-hub (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary — the five canonical roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Code conventions

Use the task-based reading index in `CONTRIBUTING.md#which-guide-to-read` to select relevant guides and sections. Read `docs/code-style.md` when writing or reviewing code, and `docs/codebase-structure.md` when adding or reorganizing modules, changing dependencies, composing screens, or choosing tests. Read `packages/shared/src/core/i18n/README.md` when adding user-facing copy or changing locale behavior. Follow applicable conventions; do not load every linked guide for every task.
