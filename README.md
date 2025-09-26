# Louie

Louie automates Codex CLI workflows based on task files and GitHub issues. Draft task files from a mobile device using a cloud-synced editor such as Obsidian, then run Louie on a remote server to turn those tasks into code.

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Processing Tasks](#processing-tasks)
- [Configuration](#configuration)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Features

- Launch Codex CLI with a single prompt or a whole series of scripted tasks.
- Stream Codex output directly in your shell and capture per-task logs when processing tasks.
- Skip completed tasks automatically when a matching `.log` file already exists.
- Validate configuration early with actionable error messages.
- Resolve task folders from config or a `--task-folder` override with natural filename sorting.
- Cross-platform support: automatically resolves to `codex.cmd` on Windows.

## Requirements

- Node.js 20 or newer
- pnpm 9 or newer (or another compatible package manager)
- Codex CLI available on your `PATH` (`codex` or `codex.cmd`)

## Installation

Install the project dependencies:

```bash
pnpm install
```

Build the distributable bundle:

```bash
pnpm build
```

Optionally link the CLI globally while developing:

```bash
pnpm link --global
```

## Quick Start

Run Louie with an inline prompt (requires Codex CLI to be installed):

```bash
louie "Implement the new CLI flow"
```

Louie forwards the prompt to `codex exec --full-auto --skip-git-repo-check` and mirrors the Codex CLI output. Supplying an empty prompt results in an error, and `--task-folder` is ignored unless `--process-tasks` is provided.

## Processing Tasks

Louie can process a sequence of prompts stored as task files. Use the `--process-tasks` flag to trigger task mode:

```bash
louie --process-tasks
louie --process-tasks --task-folder ./alternate-tasks
```

When this flag is set, Louie loads tasks either from the folder declared in `louie.config.mjs` or from the folder passed to `--task-folder`. Any prompt passed alongside `--process-tasks` is ignored, and Louie prints a warning to remind you.

Task files are discovered with natural filename sorting. Files ending in `.log` or `.tmp` are ignored, empty files are skipped with a warning, and each successful run writes a `.tmp` file that is later finalized as `<task-name>.log`. If a `.log` already exists for a task, Louie skips the task to avoid rerunning completed work.

Task folders can be regular directories or symlinks. Louie resolves symlinks before reading files and reports a descriptive error when the target is missing or not a directory.

## Configuration

Create a `louie.config.mjs` file in the directory where you run the CLI. Export an object that points to your task folder. Louie accepts any of the following fields and resolves them relative to the config file:

```js
// louie.config.mjs
export default {
  taskFolder: "./tasks", // Alternatives: tasksFolder, tasks: { folder: "./tasks" }, tasks: { path: "./tasks" }
};
```

Place Markdown, text, or any plain-text files inside the tasks folder—each file becomes a single Codex prompt. Louie stops with an error when the folder is missing, cannot be read, or contains no usable task files. You can bypass configuration entirely by supplying `--process-tasks --task-folder <folder>` at runtime.

## Development

Helpful scripts for local development:

```bash
pnpm dev -- "Draft the release notes"   # Run the CLI directly with tsx
pnpm lint                                # ESLint over the project
pnpm format                              # Check formatting
pnpm format:write                        # Fix formatting issues
```

`pnpm prepublishOnly` runs linting and an optimized build to prepare the package for publication.

## Troubleshooting

- `Codex CLI not found`: ensure the `codex` command (or `codex.cmd` on Windows) is installed and available on your `PATH`.
- `No task files found`: confirm your `louie.config.mjs` points to an existing directory that contains non-empty files.
- `Failed to read task file`: inspect the referenced file path for permissions or encoding issues.

## Contributing

Issues and pull requests are welcome. Before submitting, please run `pnpm lint` and `pnpm build` to validate your changes.

## License

MIT
