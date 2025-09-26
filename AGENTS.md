# Repository Guidelines

## Project Structure & Module Organization
- Source lives in `src/cli.ts`; `tsup` outputs to `dist/`, which stays checked in for publishing.
- Task prompts live in `tasks/`; `.md` files are prompts while `.log` captures finished runs and remains auto-skipped.
- Root configs (`eslint.config.js`, `prettier.config.js`, `louie.config.mjs`, `tsup.config.ts`) steer linting, formatting, task resolution, and builds—adjust them together when behavior changes.

## Build, Test, and Development Commands
- `pnpm install`: Install dependencies (Node.js ≥ 20 and pnpm ≥ 9).
- `pnpm dev -- "Draft the release notes"`: Run the CLI from source through `tsx`; swap the quoted text with your prompt.
- `pnpm build`: Produce the distributable bundle in `dist/` via `tsup`.
- `pnpm lint`: Run ESLint with type-aware checks; fix any surfaced issues before opening a PR.
- `pnpm format` / `pnpm format:write`: Check or apply Prettier formatting.

## Coding Style & Naming Conventions
- Follow TypeScript strictness enforced by ESLint + `typescript-eslint` recommended configs.
- Accept Prettier defaults: 2-space indentation, double quotes, trailing commas, and LF line endings.
- Prefer descriptive function names (e.g., `runTasksMode`), camelCase variables, and PascalCase types; keep modules single-purpose.
- Avoid inline `console.log` noise—use structured messaging that mirrors current CLI patterns.

## Testing Guidelines
- No automated test suite exists yet; rely on `pnpm dev` for smoke-testing scenarios and `pnpm build` to verify bundling succeeds.
- When adding critical behavior, introduce isolated CLI harness tests and document how to run them here.
- Ensure new task workflows create the expected `.tmp` then `.log` files inside `tasks/` during manual runs.

## Commit & Pull Request Guidelines
- Follow the conventional-style prefixes seen in history (`feat:`, `fix:`, `refactor:`) and keep commit messages imperative and scoped to a single change.
- Before pushing, run `pnpm lint` and `pnpm build` and note the results in the PR description when relevant.
- PRs should summarize intent, link any tracked issues, and note how to reproduce or validate new task flows. Add screenshots or terminal captures when CLI UX changes.

## Configuration Tips
- Declare task folders in `louie.config.mjs` (`taskFolder`, `tasksFolder`, or `tasks.folder`); paths resolve relative to the config file.
- Use `--process-tasks` to run queued prompts and prefer symlink-friendly paths so remote environments stay portable.
- Keep production credentials out of task files and configs—logs stored beside prompts are plain text.
