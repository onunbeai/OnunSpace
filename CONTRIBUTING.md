# Contributing to OnunSpace

Issues and pull requests are welcome. For a substantial change, open an issue describing the user problem and intended behavior before starting implementation.

## Development setup

Follow the [README](README.md#run-locally). Run `npm ci` and `npm run dev`; the browser editor and API start together. Chromium and FFmpeg are needed for local rendering and the integration tests that exercise it.

- `src/`: React editor and browser behavior.
- `shared/`: project and motion contracts shared with the server.
- `server/`: local storage, provider adapters, generation, rendering, and MCP.
- `desktop/`: Electron launcher and limited desktop bridge.
- `tests/` and `server/*.test.ts`: unit and integration tests.

Keep changes focused and preserve existing user projects. Add meaningful regression coverage for behavior changes. Check `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`; explain any environment-related failures in the pull request. For UI changes, check keyboard behavior, narrow layouts, and both English and Portuguese. Use temporary projects for testing.

Do not commit `.env` files, credentials, personal projects, generation outputs, browser profiles, dependency folders, or test evidence. Mock paid provider requests in tests and never embed an API key. Document new environment options in `.env.example` using empty or clearly illustrative values.

Pull requests should explain the problem, resulting behavior, and validation. Contributions to original code are provided under the repository's MIT License. Preserve separate licenses and provenance for third-party assets. Report security issues through the process in [SECURITY.md](SECURITY.md), not a public issue containing exploit details or secrets.
