import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;
const PROMPT = "> ";
const MAX_RESIDENT = 3;

type ReadOptions = {
  timeoutMs?: number;
  onChunk?: (chunk: string) => void;
};

type RuntimeOverrides = {
  streaming: boolean;
  model: string | null;
};

type PendingRead = {
  buffer: string;
  emittedLength: number;
  timeout: NodeJS.Timeout;
  onChunk?: (chunk: string) => void;
  resolve: (value: string) => void;
  reject: (reason?: unknown) => void;
};

function normalizeChunk(chunk: string) {
  return chunk.replace(ANSI_PATTERN, "").replace(/\r/g, "");
}

function findPromptStart(buffer: string): number {
  if (buffer === PROMPT) {
    return 0;
  }
  if (buffer.endsWith(`\n${PROMPT}`)) {
    return buffer.length - (`\n${PROMPT}`).length;
  }
  if (buffer.endsWith(PROMPT) && buffer.length > 2 && buffer[buffer.length - 3] === "\n") {
    return buffer.length - 2;
  }
  return -1;
}

function cleanModelOutput(output: string): string {
  return output
    .replace(/\r/g, "")
    .replace(ANSI_PATTERN, "")
    .replace(/^thinking\.\.\.\s*$/gm, "")
    .replace(/^\n+/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

function buildRuntimeEnv(overrides: RuntimeOverrides): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ITTE_COLOR_COMMANDS: "0",
    ITTE_SHOW_THINKING: "0",
    ITTE_BANNER_DELAY_SEC: "0",
    ITTE_WELCOME_CHAR_DELAY_SEC: "0",
    ITTE_WEB_MODE: "1",
    ITTE_BILINGUAL_ASSIST: "0",
    ITTE_STREAM: overrides.streaming ? "1" : "0",
  };

  if (overrides.model) {
    env.ITTE_MODEL = overrides.model;
  }

  return env;
}

function resolveIttePaths() {
  const explicitScript = process.env.ITTE_SCRIPT_PATH;
  if (explicitScript) {
    const scriptPath = path.resolve(explicitScript);
    return { scriptPath, cwd: path.dirname(scriptPath) };
  }

  const cwd = process.cwd();
  const projectRoot = path.basename(cwd) === "web" ? path.resolve(cwd, "..") : cwd;
  return { scriptPath: path.resolve(projectRoot, "itte"), cwd: projectRoot };
}

function resolveSessionHome(sessionId: string) {
  const configuredRoot = process.env.ITTE_WEB_HOME_ROOT?.trim();
  const projectRoot = resolveIttePaths().cwd;
  const homeRoot = configuredRoot ? path.resolve(configuredRoot) : path.resolve(projectRoot, ".itte-web-home");
  return path.resolve(homeRoot, sessionId);
}

class SessionRunner {
  private readonly sessionId: string;
  private readonly child: ChildProcessWithoutNullStreams;
  private opQueue = Promise.resolve();
  private pendingRead: PendingRead | null = null;
  private unusable = false;

  constructor(sessionId: string, env: NodeJS.ProcessEnv) {
    this.sessionId = sessionId;
    const { scriptPath, cwd } = resolveIttePaths();
    const sessionHome = resolveSessionHome(sessionId);
    mkdirSync(sessionHome, { recursive: true });

    this.child = spawn(scriptPath, [], {
      cwd,
      env: {
        ...env,
        HOME: sessionHome,
      },
      stdio: "pipe",
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.handleData(chunk));
    this.child.stderr.on("data", (chunk: string) => this.handleData(chunk));
    this.child.on("exit", () => this.handleExit());
    this.child.on("error", () => this.handleExit());
  }

  private handleExit() {
    this.unusable = true;
    if (!this.pendingRead) {
      return;
    }

    clearTimeout(this.pendingRead.timeout);
    this.pendingRead.reject(new Error(`Session process ${this.sessionId} exited unexpectedly.`));
    this.pendingRead = null;
  }

  private handleData(chunk: string) {
    if (!this.pendingRead) {
      return;
    }

    const text = normalizeChunk(chunk);
    if (!text) {
      return;
    }

    this.pendingRead.buffer += text;
    this.flushPendingRead();
  }

  private emitPending(toLength: number) {
    if (!this.pendingRead?.onChunk) {
      this.pendingRead!.emittedLength = toLength;
      return;
    }

    if (toLength <= this.pendingRead.emittedLength) {
      return;
    }

    const chunk = this.pendingRead.buffer.slice(this.pendingRead.emittedLength, toLength);
    this.pendingRead.emittedLength = toLength;
    if (chunk) {
      this.pendingRead.onChunk(chunk);
    }
  }

  private flushPendingRead() {
    if (!this.pendingRead) {
      return;
    }

    const promptStart = findPromptStart(this.pendingRead.buffer);

    if (promptStart >= 0) {
      this.emitPending(promptStart);
      const content = this.pendingRead.buffer.slice(0, promptStart);
      clearTimeout(this.pendingRead.timeout);
      const resolve = this.pendingRead.resolve;
      this.pendingRead = null;
      resolve(content);
      return;
    }

    // Keep a tiny tail so split prompt bytes are not emitted prematurely.
    const flushUntil = Math.max(0, this.pendingRead.buffer.length - 3);
    this.emitPending(flushUntil);
  }

  private readUntilPrompt({ timeoutMs = 25000, onChunk }: ReadOptions = {}): Promise<string> {
    if (this.pendingRead) {
      return Promise.reject(new Error(`Session ${this.sessionId} already has pending read.`));
    }

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.unusable = true;
        if (this.pendingRead) {
          const rejectPending = this.pendingRead.reject;
          this.pendingRead = null;
          rejectPending(new Error(`Session ${this.sessionId} timed out while waiting for prompt.`));
        }
        if (this.child.exitCode === null) {
          this.child.kill("SIGTERM");
        }
      }, timeoutMs);

      this.pendingRead = {
        buffer: "",
        emittedLength: 0,
        timeout,
        onChunk,
        resolve,
        reject,
      };
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.opQueue.then(task, task);
    this.opQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async start() {
    await this.enqueue(async () => {
      await this.readUntilPrompt({ timeoutMs: 30000 });
    });
  }

  async sendLine(line: string, options: ReadOptions = {}): Promise<string> {
    return this.enqueue(async () => {
      if (this.unusable || this.child.exitCode !== null) {
        throw new Error(`Session process ${this.sessionId} is not running.`);
      }

      const readPromise = this.readUntilPrompt(options);
      this.child.stdin.write(`${line}\n`);
      const output = await readPromise;
      return cleanModelOutput(output);
    });
  }

  close() {
    if (this.pendingRead) {
      clearTimeout(this.pendingRead.timeout);
      this.pendingRead.reject(new Error(`Session ${this.sessionId} closed.`));
      this.pendingRead = null;
    }

    if (this.child.exitCode === null) {
      this.child.kill("SIGTERM");
    }
  }
}

export class SessionProcessManager {
  private readonly runners = new Map<string, SessionRunner>();

  private touch(sessionId: string) {
    const runner = this.runners.get(sessionId);
    if (!runner) {
      return;
    }
    this.runners.delete(sessionId);
    this.runners.set(sessionId, runner);
  }

  private evictIfNeeded() {
    while (this.runners.size > MAX_RESIDENT) {
      const oldestSessionId = this.runners.keys().next().value as string | undefined;
      if (!oldestSessionId) {
        return;
      }
      const oldestRunner = this.runners.get(oldestSessionId);
      this.runners.delete(oldestSessionId);
      oldestRunner?.close();
    }
  }

  hasSession(sessionId: string) {
    return this.runners.has(sessionId);
  }

  async ensureSessionProcess(
    sessionId: string,
    options: {
      runtime: RuntimeOverrides;
      replayInputs?: string[];
    },
  ) {
    const existing = this.runners.get(sessionId);
    if (existing) {
      this.touch(sessionId);
      return;
    }

    const runner = new SessionRunner(sessionId, buildRuntimeEnv(options.runtime));
    await runner.start();

    const replayInputs = options.replayInputs ?? [];
    for (const input of replayInputs) {
      await runner.sendLine(input, { timeoutMs: 35000 });
    }

    this.runners.set(sessionId, runner);
    this.touch(sessionId);
    this.evictIfNeeded();
  }

  async sendLine(sessionId: string, line: string, options: ReadOptions = {}) {
    const runner = this.runners.get(sessionId);
    if (!runner) {
      throw new Error(`Session ${sessionId} does not have a running process.`);
    }

    this.touch(sessionId);
    return runner.sendLine(line, options);
  }

  async endSession(sessionId: string) {
    const runner = this.runners.get(sessionId);
    if (!runner) {
      return "";
    }

    const output = await runner.sendLine("/end", { timeoutMs: 40000 });
    runner.close();
    this.runners.delete(sessionId);
    return output;
  }

  disposeSession(sessionId: string) {
    const runner = this.runners.get(sessionId);
    if (!runner) {
      return;
    }
    runner.close();
    this.runners.delete(sessionId);
  }
}

export const sessionProcessManager = new SessionProcessManager();
