import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { initialTimeline, TIMELINE_LIMITS, validateTimelineDocument } from "./registry";
import type { TimelineDocument, VersionSnapshot } from "./types";

const execFileAsync = promisify(execFile);
const FRAMEWORK_SCOPE = "resolve/";
const PROJECT_FILE = "resolve/pyproject.toml";
const FALLBACK_NOTICE = "Live repository history is unavailable. Showing verified bundled snapshots.";

export interface TimelineDiscovery {
  document: TimelineDocument;
  source: "git" | "bundled";
  notice: string | null;
}

interface DiscoveryOptions {
  /** Server-owned working directory. Never populated from request parameters. */
  cwd?: string;
  fallback?: TimelineDocument;
}

interface CommitMetadata {
  hash: string;
  createdAt: string;
  subject: string;
}

function gitEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Do not let an inherited Git checkout override the fixed project directory.
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"])
    delete env[key];
  return { ...env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1" };
}

async function git(root: string, args: string[], signal: AbortSignal): Promise<string> {
  const { stdout } = await execFileAsync("git", ["--no-pager", "-C", root, ...args], {
    encoding: "utf8",
    env: gitEnvironment(),
    timeout: 5_000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
    signal,
  });
  return stdout;
}

async function repositoryRoot(cwd: string, signal: AbortSignal): Promise<string> {
  const workingDirectory = await realpath(cwd);
  const studioSuffix = path.join("web", "studio");
  const root = workingDirectory.endsWith(path.sep + studioSuffix)
    ? path.resolve(workingDirectory, "../..")
    : workingDirectory;
  // Support running Next from web/studio or the repository root, without walking arbitrary parents.
  const studio = path.join(root, studioSuffix);
  if ((await realpath(studio)) !== studio) throw new Error("Invalid project location");
  const topLevel = (await git(root, ["rev-parse", "--show-toplevel"], signal)).trim();
  if ((await realpath(topLevel)) !== root) throw new Error("Invalid repository location");
  return root;
}

function commitsFromLog(output: string): CommitMetadata[] {
  const fields = output.split("\0");
  if (fields.at(-1) === "") fields.pop();
  if (fields.length % 3 !== 0 || fields.length / 3 > TIMELINE_LIMITS.versions)
    throw new Error("Unsupported repository history");
  const commits: CommitMetadata[] = [];
  for (let index = 0; index < fields.length; index += 3) {
    const [hash, createdAt, subject] = fields.slice(index, index + 3);
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(hash)
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(createdAt)
      || !Number.isFinite(Date.parse(createdAt))
      || !subject.trim()
      || /[\u0000-\u001f\u007f]/.test(subject))
      throw new Error("Invalid commit metadata");
    commits.push({ hash, createdAt, subject });
  }
  // Labels describe chronological source snapshots, not invented semantic releases.
  return commits.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

function projectMetadata(toml: string): Record<string, string> {
  const metadata: Record<string, string> = {};
  let inProject = false;
  for (const line of toml.split(/\r?\n/)) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (section) {
      inProject = section[1].trim() === "project";
      continue;
    }
    if (!inProject) continue;
    const entry = line.match(/^\s*(name|version|requires-python)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/);
    if (!entry) continue;
    const value = entry[2].startsWith('"') ? JSON.parse(entry[2]) : entry[2].slice(1, -1);
    if (typeof value === "string" && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value))
      metadata[entry[1]] = value;
  }
  return metadata;
}

async function sourceSnapshot(
  root: string,
  commit: CommitMetadata,
  seed: VersionSnapshot | undefined,
  signal: AbortSignal,
): Promise<VersionSnapshot | null> {
  const files = (await git(root, ["ls-tree", "-r", "--name-only", "-z", commit.hash, "--", FRAMEWORK_SCOPE], signal))
    .split("\0").filter(Boolean);
  // A removal commit has no framework tree to snapshot.
  if (!files.length) return null;
  const hasProjectFile = files.includes(PROJECT_FILE);
  const metadata = hasProjectFile
    ? projectMetadata(await git(root, ["show", `${commit.hash}:${PROJECT_FILE}`], signal))
    : {};
  if (seed
    && seed.id === commit.hash
    && seed.framework.name === metadata.name
    && seed.framework.version === metadata.version
    && Date.parse(seed.createdAt) === Date.parse(commit.createdAt)) {
    // Keep one canonical metadata record so API-backed recordings merge with saved exports.
    return { ...seed, runs: [] };
  }
  return {
    id: commit.hash,
    label: "", // Assigned after real source trees have been discovered.
    title: commit.subject,
    createdAt: commit.createdAt,
    commit: commit.hash,
    summary: commit.subject,
    framework: {
      name: metadata.name || "resolve",
      version: metadata.version || "unversioned",
      changes: [commit.subject],
      config: {
        ...(metadata["requires-python"] ? { requiresPython: metadata["requires-python"] } : {}),
      },
      sourceRefs: hasProjectFile ? [{
        id: `${commit.hash}-project`, label: "Committed package metadata", kind: "SOURCE", ref: PROJECT_FILE,
      }] : [],
    },
    scenarios: [],
    // Source definitions, fixtures, and passing test files are not recorded run artifacts.
    runs: [],
  };
}

export async function discoverTimeline(options: DiscoveryOptions = {}): Promise<TimelineDiscovery> {
  const fallback = validateTimelineDocument(options.fallback ?? initialTimeline);
  try {
    const signal = AbortSignal.timeout(15_000);
    const root = await repositoryRoot(options.cwd ?? process.cwd(), signal);
    const log = await git(root, [
      "log", "--reverse", "--topo-order", "-z", "--format=%H%x00%cI%x00%s", "HEAD", "--", FRAMEWORK_SCOPE,
    ], signal);
    const commits = commitsFromLog(log);
    const versions: VersionSnapshot[] = [];
    for (const commit of commits) {
      const snapshot = await sourceSnapshot(root, commit, fallback.versions.find((version) => version.commit === commit.hash), signal);
      if (snapshot) versions.push({ ...snapshot, label: snapshot.label || `v${versions.length + 1}` });
    }
    return { document: validateTimelineDocument({ schemaVersion: 1, versions }), source: "git", notice: null };
  } catch {
    // Do not expose command output, filesystem locations, or environment details in API responses.
    return { document: fallback, source: "bundled", notice: FALLBACK_NOTICE };
  }
}
