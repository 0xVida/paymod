# Changelog

## 0.0.1

Initial capability set.

### Added

- Sessions: create, rename (auto-named from the first prompt), delete,
  favorite, multi-select delete, sort (newest/oldest/most tokens), search.
- Chat: streaming responses, a tool-activity feed with clickable file
  references (a read opens the file, an edit opens the real diff, both on
  click rather than automatically), diff review in-chat with an on-demand
  "open in editor" action.
- Tools: `read_file`, `list_directory`, `search_files`, `apply_patch`,
  `run_command` (live output streaming; stopping a turn actually kills the
  process), `run_tests`, `git_status`, `git_diff`, `git_log`. Workspace
  confinement enforced for every model-facing path.
- Auto-approve, per tool, per session.
- Plan/Act mode and rule file discovery (`CLAUDE.md`, `AGENTS.md`, etc,
  toggle which are active).
- Model selection (GPT-4o, Claude Sonnet) via Paymod's managed inference
  proxy, with real per-turn token usage and context-window display.
- BYOK: a personal OpenAI/Anthropic API key routes that provider's models
  straight to the real provider, bypassing Paymod's proxy and balance
  entirely.
- Device-code sign-in.
