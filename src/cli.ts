import { Command } from "commander";
import { spawn } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type LouieConfig = {
  taskFolder?: string;
  tasksFolder?: string;
  tasks?: {
    folder?: string;
    path?: string;
  };
};

type LouieTask = {
  name: string;
  prompt: string;
};

type ProgramOptions = {
  processTasks?: boolean;
};

const program = new Command();

program
  .name("louie")
  .description("Launch the Codex CLI with the provided prompt or configured tasks")
  .argument("[prompt...]", "Prompt to execute via Codex")
  .option("--process-tasks", "Process tasks defined in louie.config.mjs")
  .action(async (promptParts: string[], options: ProgramOptions) => {
    const prompt = promptParts.join(" ").trim();
    const shouldProcessTasks = Boolean(options?.processTasks);

    if (!shouldProcessTasks) {
      if (!prompt) {
        console.error("A prompt is required unless --process-tasks is provided.");
        process.exitCode = 1;
        return;
      }

      const success = await executePrompt(prompt);

      if (!success) {
        process.exitCode = 1;
      }

      return;
    }

    if (prompt) {
      console.warn("Ignoring prompt because --process-tasks was provided.");
    }

    let tasks: LouieTask[];

    try {
      tasks = await loadTasksFromConfig();
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
      return;
    }

    for (const task of tasks) {
      console.info(`[louie] Running task: ${task.name}`);
      const success = await executePrompt(task.prompt);

      if (!success) {
        process.exitCode = 1;
        break;
      }
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});

async function executePrompt(prompt: string): Promise<boolean> {
  const executable = process.platform === "win32" ? "codex.cmd" : "codex";
  const child = spawn(executable, ["exec", "--full-auto", "--skip-git-repo-check", prompt], {
    stdio: "inherit",
  });

  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      child.on("error", rejectPromise);
      child.on("exit", (code, signal) => {
        if (code === 0) {
          resolvePromise();
          return;
        }

        const reason =
          code !== null
            ? `exit code ${code}`
            : signal !== null
              ? `signal ${signal}`
              : "an unknown reason";
        rejectPromise(new Error(`Codex CLI terminated with ${reason}.`));
      });
    });

    return true;
  } catch (error) {
    const { code, message } = error as NodeJS.ErrnoException;

    if (code === "ENOENT") {
      console.error(
        "Codex CLI not found. Please ensure the `codex` command is available in your PATH."
      );
    } else {
      console.error(message);
    }

    return false;
  }
}

async function loadTasksFromConfig(): Promise<LouieTask[]> {
  const configPath = resolve(process.cwd(), "louie.config.mjs");

  try {
    await access(configPath);
  } catch {
    throw new Error("Could not find `louie.config.mjs` in the current working directory.");
  }

  let rawConfig: unknown;

  try {
    const imported = await import(pathToFileURL(configPath).href);
    rawConfig = imported?.default ?? imported;
  } catch (error) {
    throw new Error(`Failed to load \\"louie.config.mjs\\": ${(error as Error).message}`);
  }

  if (!rawConfig || typeof rawConfig !== "object") {
    throw new Error("`louie.config.mjs` must export an object.");
  }

  const config = rawConfig as LouieConfig;
  const folder = extractTasksFolder(config);

  if (!folder) {
    throw new Error(
      "The configuration must define a tasks folder via `taskFolder`, `tasksFolder`, or `tasks.folder`."
    );
  }

  const configDir = dirname(configPath);
  const absoluteFolder = resolve(configDir, folder);

  let entries;

  try {
    entries = await readdir(absoluteFolder, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `Failed to read tasks folder at ${absoluteFolder}: ${(error as Error).message}`
    );
  }

  const orderedFiles = entries.filter((entry) => entry.isFile()).sort((a, b) => {
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });

  const tasks: LouieTask[] = [];

  for (const file of orderedFiles) {
    const filePath = join(absoluteFolder, file.name);

    let content: string;

    try {
      content = await readFile(filePath, "utf8");
    } catch (error) {
      console.error(`Failed to read task file ${filePath}: ${(error as Error).message}`);
      continue;
    }

    const prompt = content.trim();

    if (!prompt) {
      console.warn(`[louie] Skipping empty task file: ${file.name}`);
      continue;
    }

    tasks.push({
      name: file.name,
      prompt,
    });
  }

  if (tasks.length === 0) {
    throw new Error(`No task files found in ${absoluteFolder}.`);
  }

  return tasks;
}

function extractTasksFolder(config: LouieConfig): string | null {
  const directFolder =
    typeof config.taskFolder === "string"
      ? config.taskFolder
      : typeof config.tasksFolder === "string"
        ? config.tasksFolder
        : null;

  if (directFolder) {
    return directFolder;
  }

  if (!config.tasks || typeof config.tasks !== "object") {
    return null;
  }

  const nested = config.tasks as Record<string, unknown>;
  const nestedFolder = nested.folder ?? nested.path;

  return typeof nestedFolder === "string" ? nestedFolder : null;
}
