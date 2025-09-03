# Repository Guidelines

## Project Structure & Modules
- src/: extension source (ES modules)
  - src/extension/: Chrome service worker (`background.js`) and content script (`content.js`)
  - src/ui/: sidebar UI (`sidebar.html`, `sidebar.js`, styles) and managers
  - src/core/: chat logic (composition, processing, history)
  - src/api/: API settings and request building
  - src/utils/, src/storage/, src/debug/: helpers, IndexedDB, dev tools
- lib/: vendored third‑party assets (KaTeX, Highlight.js, Cytoscape, etc.)
- icons/, statics/: images and static assets
- manifest.json: Chrome extension manifest (v3)

## Build, Test, and Development
- Run locally: Chrome → Extensions → Enable Developer Mode → Load unpacked → select repo root.
- No build step: code runs as-is; libs are pre-bundled in `lib/`.
- Zip for manual release: `zip -r cerebr.zip . -x "*.git*" -x "*.github*" -x "*.DS_Store" -x "README*"`.
- CI release: pushing a tag `v*` creates a ZIP and GitHub Release.

## Coding Style & Naming
- JavaScript ES modules; 2-space indentation; use semicolons.
- camelCase for variables/functions; PascalCase for factory types if introduced.
- Filenames: snake_case.js (e.g., `message_processor.js`).
- Keep zero-build: avoid adding bundlers/deps without discussion.

## Testing Guidelines
- No automated tests yet; validate manually:
  - Load unpacked, open any page, open the sidebar (toolbar icon or configured shortcut).
  - Exercise chat send/stream, markdown/math rendering, code highlighting, screenshots, and context menus.
- Prefer small, verifiable changes; include repro steps in PRs.

## Commit & Pull Requests
- Commits: short, imperative, and scoped (project history uses Chinese, e.g., “修复…”, “添加…”). Link issues when relevant.
- PRs must include:
  - Description of change and rationale
  - Testing steps and expected results
  - Screenshots/GIFs for UI changes
  - Notes on permissions/manifest changes

## Security & Configuration
- Do not commit API keys; keys are stored via the UI in `chrome.storage.sync`.
- Be cautious changing `permissions`/`host_permissions` in `manifest.json`; propose rationale and least privilege.
- Follow existing patterns in `src/api/api_settings.js` for handling secrets and sync chunking.

## Architecture Overview
- Core drives chat flow; UI renders sidebar; Extension layer wires background/content; API manages model configs.
