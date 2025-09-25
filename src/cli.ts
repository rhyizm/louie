import { Command } from "commander";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  access,
  lstat,
  readdir,
  readFile,
  realpath,
  rename,
} from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
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
  filePath: string;
};

type ProgramOptions = {
  processTasks?: boolean;
  tasksFolder?: string;
};

type ExecutePromptLogging = {
  logTmpPath: string;
  logFinalPath: string;
};

const program = new Command();

program
  .name("louie")
  .description(
    "Launch the Codex CLI with the provided prompt or configured tasks",
  )
  .argument("[prompt...]", "Prompt to execute via Codex")
  .option("--process-tasks", "Process tasks defined in louie.config.mjs")
  .option(
    "--tasks-folder <folder>",
    "Process tasks located in the specified folder",
  )
  .action(async (promptParts: string[], options: ProgramOptions) => {
    const prompt = promptParts.join(" ").trim();
    const shouldProcessTasks = Boolean(options?.processTasks);
    const tasksFolderOverride = options?.tasksFolder;

    if (!shouldProcessTasks) {
      if (tasksFolderOverride) {
        console.error(
          "--tasks-folder can only be used together with --process-tasks.",
        );
        process.exitCode = 1;
        return;
      }

      if (!prompt) {
        console.error(
          "A prompt is required unless --process-tasks is provided.",
        );
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
      if (tasksFolderOverride) {
        const absoluteFolder = resolve(process.cwd(), tasksFolderOverride);
        tasks = await loadTasksFromDirectory(absoluteFolder);
      } else {
        tasks = await loadTasksFromConfig();
      }
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
      return;
    }

    for (const task of tasks) {
      const { dir, name } = parse(task.filePath);
      const tmpLogPath = join(dir, `${name}.tmp`);
      const finalLogPath = join(dir, `${name}.log`);

      try {
        if (await fileExists(finalLogPath)) {
          console.info(
            `[louie] Skipping task: ${task.name} (log already exists).`,
          );
          continue;
        }
      } catch (error) {
        console.error(
          `Failed to inspect log for ${task.name}: ${(error as Error).message}`,
        );
        process.exitCode = 1;
        break;
      }

      console.info(`[louie] Running task: ${task.name}`);
      const success = await executePrompt(task.prompt, {
        logTmpPath: tmpLogPath,
        logFinalPath: finalLogPath,
      });

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

async function executePrompt(
  prompt: string,
  logging?: ExecutePromptLogging,
): Promise<boolean> {
  const executable = process.platform === "win32" ? "codex.cmd" : "codex";
  let logStream: ReturnType<typeof createWriteStream> | undefined;

  if (logging) {
    try {
      logStream = createWriteStream(logging.logTmpPath, { flags: "w" });
      await new Promise<void>((resolvePromise, rejectPromise) => {
        const handleError = (error: Error) => {
          logStream?.removeListener("open", handleOpen);
          rejectPromise(error);
        };
        const handleOpen = () => {
          logStream?.removeListener("error", handleError);
          resolvePromise();
        };

        logStream.once("error", handleError);
        logStream.once("open", handleOpen);
      });
    } catch (error) {
      console.error(
        `Failed to create task log at ${logging.logTmpPath}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  const child = spawn(
    executable,
    ["exec", "--full-auto", "--skip-git-repo-check", prompt],
    logging
      ? { stdio: ["inherit", "pipe", "pipe"] as const }
      : { stdio: "inherit" },
  );

  if (logStream) {
    const forwardStdout = (chunk: Buffer) => {
      process.stdout.write(chunk);
      logStream?.write(chunk);
    };
    const forwardStderr = (chunk: Buffer) => {
      process.stderr.write(chunk);
      logStream?.write(chunk);
    };

    child.stdout?.on("data", forwardStdout);
    child.stderr?.on("data", forwardStderr);
  }

  let success = false;

  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      child.on("error", rejectPromise);
      child.on("close", (code, signal) => {
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

    success = true;
  } catch (error) {
    const { code, message } = error as NodeJS.ErrnoException;

    if (code === "ENOENT") {
      const notFoundMessage =
        "Codex CLI not found. Please ensure the `codex` command is available in your PATH.";
      console.error(notFoundMessage);
      logStream?.write(`${notFoundMessage}\n`);
    } else {
      console.error(message);
      logStream?.write(`${message}\n`);
    }

    success = false;
  } finally {
    if (logStream && logging) {
      const stream = logStream;
      try {
        await new Promise<void>((resolvePromise, rejectPromise) => {
          stream.once("error", rejectPromise);
          stream.end(() => resolvePromise());
        });
      } catch (streamError) {
        console.error(
          `Failed to finalize log file at ${logging.logTmpPath}: ${(streamError as Error).message}`,
        );
        success = false;
      }

      try {
        await rename(logging.logTmpPath, logging.logFinalPath);
      } catch (renameError) {
        console.error(
          `Failed to rename log file ${logging.logTmpPath} to ${logging.logFinalPath}: ${(renameError as Error).message}`,
        );
        success = false;
      }
    }
  }

  return success;
}

async function loadTasksFromConfig(): Promise<LouieTask[]> {
  const configPath = resolve(process.cwd(), "louie.config.mjs");

  try {
    await access(configPath);
  } catch {
    throw new Error(
      "Could not find `louie.config.mjs` in the current working directory.",
    );
  }

  let rawConfig: unknown;

  try {
    const importedModule: unknown = await import(
      pathToFileURL(configPath).href
    );

    if (
      importedModule &&
      typeof importedModule === "object" &&
      "default" in importedModule
    ) {
      rawConfig = (importedModule as { default: unknown }).default;
    } else {
      rawConfig = importedModule;
    }
  } catch (error) {
    throw new Error(
      `Failed to load \\"louie.config.mjs\\": ${(error as Error).message}`,
    );
  }

  if (!rawConfig || typeof rawConfig !== "object") {
    throw new Error("`louie.config.mjs` must export an object.");
  }

  const config = rawConfig as LouieConfig;
  const folder = extractTasksFolder(config);

  if (!folder) {
    throw new Error(
      "The configuration must define a tasks folder via `taskFolder`, `tasksFolder`, or `tasks.folder`.",
    );
  }

  const configDir = dirname(configPath);
  const absoluteFolder = resolve(configDir, folder);

  return loadTasksFromDirectory(absoluteFolder);
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

async function loadTasksFromDirectory(
  absoluteFolder: string,
): Promise<LouieTask[]> {
  const resolvedFolder = await resolveTasksFolderPath(absoluteFolder);
  let entries;

  try {
    entries = await readdir(resolvedFolder, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `Failed to read tasks folder at ${absoluteFolder}: ${(error as Error).message}`,
    );
  }

  const orderedFiles = entries
    .filter((entry) => entry.isFile())
    .sort((a, b) => {
      return a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });

  const tasks: LouieTask[] = [];

  for (const file of orderedFiles) {
    const filePath = join(resolvedFolder, file.name);
    const extension = parse(file.name).ext.toLowerCase();

    if (extension === ".log" || extension === ".tmp") {
      continue;
    }

    let content: string;

    try {
      content = await readFile(filePath, "utf8");
    } catch (error) {
      console.error(
        `Failed to read task file ${filePath}: ${(error as Error).message}`,
      );
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
      filePath,
    });
  }

  if (tasks.length === 0) {
    throw new Error(`No task files found in ${absoluteFolder}.`);
  }

  return tasks;
}

async function resolveTasksFolderPath(folderPath: string): Promise<string> {
  let stats;

  try {
    stats = await lstat(folderPath);
  } catch (error) {
    const { code, message } = error as NodeJS.ErrnoException;

    if (code === "ENOENT") {
      throw new Error(`Tasks folder not found at ${folderPath}.`);
    }

    throw new Error(
      `Failed to access tasks folder at ${folderPath}: ${message}`,
    );
  }

  if (stats.isSymbolicLink()) {
    let resolved;

    try {
      resolved = await realpath(folderPath);
    } catch (error) {
      throw new Error(
        `Failed to resolve tasks folder symlink at ${folderPath}: ${(error as Error).message}`,
      );
    }

    try {
      const targetStats = await lstat(resolved);

      if (!targetStats.isDirectory()) {
        throw new Error(
          `Tasks folder symlink at ${folderPath} does not point to a directory (resolved to ${resolved}).`,
        );
      }
    } catch (error) {
      throw new Error(
        `Failed to inspect resolved tasks folder at ${resolved}: ${(error as Error).message}`,
      );
    }

    return resolved;
  }

  if (!stats.isDirectory()) {
    throw new Error(`Tasks folder at ${folderPath} is not a directory.`);
  }

  return folderPath;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}
