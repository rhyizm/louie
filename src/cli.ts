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

/**
 * Configuration properties supported when launching tasks through the Louie CLI.
 */
type LouieConfig = {
  taskFolder?: string;
  tasksFolder?: string;
  tasks?: {
    folder?: string;
    path?: string;
  };
};

/**
 * Task metadata describing a prompt file to execute.
 */
type LouieTask = {
  name: string;
  prompt: string;
  filePath: string;
};

/**
 * Commander CLI options defining the behavior of the execution flow.
 */
type ProgramOptions = {
  processTasks?: boolean;
  taskFolder?: string;
};

/**
 * File paths used for capturing Codex CLI execution logs.
 */
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
  /**
   * Process tasks defined in louie.config.mjs or a specified folder.
   *
   * When enabled, the CLI loads task files from the folder specified by --task-folder,
   * or from the configuration in louie.config.mjs (using `taskFolder`, `tasksFolder`, or `tasks.folder`).
   *
   * Task files are loaded in ascending order by filename (using localeCompare with numeric sorting and case-insensitivity).
   * Files with .log or .tmp extensions are ignored.
   *
   * If the specified or configured tasks folder does not exist, is not a directory, or contains no valid task files,
   * the CLI will exit with an error and no tasks will be processed.
   *
   * There is no fallback to another folder if the tasks folder is missing or empty.
   */
  .option(
    "--process-tasks",
    "Process tasks defined in louie.config.mjs"
  )
  .option(
    "--task-folder <folder>",
    "Process tasks located in the specified folder",
  )
  .action(runCliAction);

/**
 * Handles CLI invocation by delegating to prompt or task execution modes.
 * @param promptParts - Tokens composing the user-supplied prompt.
 * @param options - Parsed Commander flags determining execution behavior.
 * @returns A promise that resolves after the requested workflow completes.
 */
async function runCliAction(
  promptParts: string[],
  options: ProgramOptions,
): Promise<void> {
  const prompt = promptParts.join(" ").trim();
  const shouldProcessTasks = Boolean(options?.processTasks);
  const tasksFolderOverride = options?.taskFolder;

  if (!shouldProcessTasks) {
    await runPromptMode(prompt, tasksFolderOverride);
    return;
  }

  await runTasksMode(prompt, tasksFolderOverride);
}

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});

/**
 * Executes the CLI in prompt mode, requiring a direct prompt string.
 * @param prompt - Normalized prompt to execute through the Codex CLI.
 * @param tasksFolderOverride - Optional tasks folder override, invalid in prompt mode.
 * @returns A promise that resolves once prompt execution has finished.
 */
async function runPromptMode(
  prompt: string,
  tasksFolderOverride?: string,
): Promise<void> {
  if (tasksFolderOverride) {
    console.error(
      "--task-folder can only be used together with --process-tasks.",
    );
    process.exitCode = 1;
    return;
  }

  if (!prompt) {
    console.error("A prompt is required unless --process-tasks is provided.");
    process.exitCode = 1;
    return;
  }

  const success = await executePrompt(prompt);

  if (!success) {
    process.exitCode = 1;
  }
}

/**
 * Executes the CLI in tasks mode by loading tasks and running them sequentially.
 * @param prompt - Prompt passed on the command line, ignored in tasks mode.
 * @param tasksFolderOverride - Optional folder containing task files.
 * @returns A promise that resolves after all tasks have been processed.
 */
async function runTasksMode(
  prompt: string,
  tasksFolderOverride?: string,
): Promise<void> {
  if (prompt) {
    console.warn("Ignoring prompt because --process-tasks was provided.");
  }

  let tasks: LouieTask[];

  try {
    tasks = await loadTasksForCli(tasksFolderOverride);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }

  await runTasks(tasks);
}

/**
 * Resolves the set of tasks to run using either configuration or an override folder.
 * @param tasksFolderOverride - Optional path supplied via the CLI.
 * @returns A promise containing the ordered tasks to execute.
 */
async function loadTasksForCli(
  tasksFolderOverride?: string,
): Promise<LouieTask[]> {
  if (tasksFolderOverride) {
    const absoluteFolder = resolve(process.cwd(), tasksFolderOverride);
    return loadTasksFromDirectory(absoluteFolder);
  }

  const tasksFromConfig = await loadTasksFromConfig();

  if (tasksFromConfig !== null) {
    return tasksFromConfig;
  }

  const defaultFolder = resolve(process.cwd(), "tasks");
  return loadTasksFromDirectory(defaultFolder);
}

/**
 * Runs each task sequentially while managing log files and error handling.
 * @param tasks - Tasks to execute through the Codex CLI.
 * @returns A promise that resolves once iteration completes or aborts on failure.
 */
async function runTasks(tasks: LouieTask[]): Promise<void> {
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
}

/**
 * Spawns the Codex CLI to execute a prompt and optionally capture output logs.
 * @param prompt - Prompt string forwarded to the Codex CLI.
 * @param logging - Optional log file paths for capturing execution output.
 * @returns A promise resolving to true when Codex completes successfully.
 */
async function executePrompt(
  prompt: string,
  logging?: ExecutePromptLogging,
): Promise<boolean> {
  const executable = process.platform === "win32" ? "codex.cmd" : "codex";
  let logStream: ReturnType<typeof createWriteStream> | undefined;

  if (logging) {
    try {
      logStream = await openLogStream(logging.logTmpPath);
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
    child.stdout?.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
      logStream?.write(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
      logStream?.write(chunk);
    });
  }

  let success = false;

  try {
    await waitForCodex(child);
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
      const finalized = await finalizeLogStream(logStream, logging);
      success = success && finalized;
    }
  }

  return success;
}

/**
 * Opens a writable stream for capturing task execution logs.
 * @param logPath - Absolute path to the temporary log file.
 * @returns A promise resolving to the writable stream once ready.
 */
async function openLogStream(
  logPath: string,
): Promise<ReturnType<typeof createWriteStream>> {
  const stream = createWriteStream(logPath, { flags: "w" });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const handleError = (error: Error) => {
      stream.removeListener("open", handleOpen);
      rejectPromise(error);
    };
    const handleOpen = () => {
      stream.removeListener("error", handleError);
      resolvePromise();
    };

    stream.once("error", handleError);
    stream.once("open", handleOpen);
  });

  return stream;
}

/**
 * Waits for the Codex process to exit and rejects if it exits abnormally.
 * @param child - Spawned Codex child process.
 * @returns A promise that resolves when the child exits successfully.
 */
async function waitForCodex(child: ReturnType<typeof spawn>): Promise<void> {
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
}

/**
 * Finalizes a log stream by closing it and renaming the temporary file.
 * @param stream - Writable stream capturing Codex output.
 * @param logging - Paths required to finalize the log file.
 * @returns A promise resolving to true when finalization succeeds.
 */
async function finalizeLogStream(
  stream: ReturnType<typeof createWriteStream>,
  logging: ExecutePromptLogging,
): Promise<boolean> {
  let success = true;

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

  return success;
}

/**
 * Loads the Louie configuration file and derives the tasks to execute.
 * @returns A promise with tasks from the configuration, or null when missing.
 */
async function loadTasksFromConfig(): Promise<LouieTask[] | null> {
  const configPath = resolve(process.cwd(), "louie.config.mjs");

  const configExists = await fileExists(configPath);

  if (!configExists) {
    return null;
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

/**
 * Extracts the tasks folder value from the provided configuration object.
 * @param config - Louie configuration loaded from disk.
 * @returns The configured tasks folder path or null when missing.
 */
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

/**
 * Reads task definitions from a directory and converts them into prompts.
 * @param absoluteFolder - Absolute path to a folder containing task files.
 * @returns A promise resolving to the discovered and ordered tasks.
 */
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

    if (file.name.startsWith(".")) {
      continue;
    }

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

/**
 * Validates the provided tasks folder path and resolves symlinks when present.
 * @param folderPath - Folder path to validate.
 * @returns A promise resolving to a usable tasks folder path.
 */
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

/**
 * Determines whether the provided path exists on disk.
 * @param path - File path to check.
 * @returns A promise resolving to true when the file exists, otherwise false.
 */
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
