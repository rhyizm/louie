# Louie

Louie is a TypeScript-powered companion CLI for the Codex CLI. It forwards either an ad-hoc prompt or a curated list of tasks to `codex exec --full-auto --skip-git-repo-check`, streaming the Codex output back to your terminal and surfacing friendly error messages when something goes wrong.

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
- Stream Codex output directly in your shell for a transparent workflow.
- Validate configuration early with actionable error messages.
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

Louie forwards the prompt to `codex exec --full-auto --skip-git-repo-check` and mirrors the Codex CLI output. Supplying an empty prompt results in an error.

## Processing Tasks

Louie can process a sequence of prompts stored as task files. Use the `--process-tasks` flag to trigger task mode:

```bash
louie --process-tasks
```

When this flag is set, Louie reads every file in the configured task folder and runs each file's contents as a separate Codex prompt, ordered by filename (natural sort). Any prompt passed alongside `--process-tasks` is ignored, and empty task files are skipped with a warning.

## Configuration

Create a `louie.config.mjs` file in the directory where you run the CLI. Export an object that points to your task folder. Louie accepts any of the following fields and resolves them relative to the config file:

```js
// louie.config.mjs
export default {
  taskFolder: "./tasks", // Alternatives: tasksFolder, tasks: { folder: "./tasks" }
};
```

Place Markdown, text, or any plain-text files inside the tasks folder—each file becomes a single Codex prompt. Louie stops with an error when the folder is missing or contains no usable task files.

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