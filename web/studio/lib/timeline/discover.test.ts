import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { discoverTimeline } from "./discover";
import { initialTimeline, mergeTimeline, validateTimelineDocument } from "./registry";
import type { TimelineDocument } from "./types";

const temporaryDirectories: string[] = [];
const emptyFallback: TimelineDocument = { schemaVersion: 1, versions: [] };

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "hyper-timeline-test-")));
  temporaryDirectories.push(root);
  const studio = path.join(root, "web/studio");
  await mkdir(studio, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-C", root, ...args], {
    encoding: "utf8", timeout: 5_000, maxBuffer: 1024 * 1024,
  }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Timeline fixture");
  git("config", "user.email", "timeline-fixture@example.invalid");
  git("config", "commit.gpgsign", "false");
  const write = async (name: string, contents: string) => {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), contents);
  };
  const commit = (subject: string, date: string) => {
    git("add", "--all");
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-C", root, "commit", "-m", subject], {
      encoding: "utf8", timeout: 5_000, maxBuffer: 1024 * 1024,
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
    return git("rev-parse", "HEAD");
  };
  await write("web/studio/package.json", "{}\n");
  commit("web scaffold", "2026-01-01T12:00:00+00:00");
  return { root, studio, git, write, commit };
}

function project(version: string) {
  return `[tool.other]\nversion = "99.0.0"\n[project]\nname = "mirror-resolve"\nversion = '${version}' # real package version\nrequires-python = ">=3.11"\n[tool.build]\nversion = "100.0.0"\n`;
}

test("discovers only actual resolve commits and each committed package version", async () => {
  const repo = await fixture();
  await repo.write("resolve/pyproject.toml", project("0.1.0"));
  const first = repo.commit("resolve: initial framework", "2026-01-02T12:00:00+00:00");
  await repo.write("web/studio/page.tsx", "export default null;\n");
  const unrelated = repo.commit("web: another interface edit", "2026-01-03T12:00:00+00:00");
  await repo.write("resolve/pyproject.toml", project("0.2.0"));
  const second = repo.commit("resolve: revised policy", "2026-01-04T12:00:00+00:00");
  await repo.write("resolve/pyproject.toml", project("9.9.9"));
  const beforeStatus = repo.git("status", "--porcelain=v1");
  const beforeIndex = await readFile(path.join(repo.root, ".git/index"));

  const result = await discoverTimeline({ cwd: repo.studio, fallback: emptyFallback });
  assert.equal(result.source, "git");
  assert.equal(result.notice, null);
  validateTimelineDocument(result.document);
  assert.deepEqual(result.document.versions.map((version) => version.commit), [first, second]);
  assert.ok(result.document.versions.every((version) => version.commit !== unrelated));
  assert.deepEqual(result.document.versions.map((version) => version.label), ["v1", "v2"]);
  assert.deepEqual(result.document.versions.map((version) => version.framework.version), ["0.1.0", "0.2.0"]);
  assert.equal(result.document.versions[1].title, "resolve: revised policy");
  assert.equal(result.document.versions[1].createdAt, repo.git("show", "-s", "--format=%cI", second));
  assert.equal(result.document.versions[0].framework.config.requiresPython, ">=3.11");
  assert.ok(result.document.versions.every((version) => version.runs.length === 0));
  assert.equal(JSON.stringify(result.document).includes(repo.root), false);
  assert.deepEqual(await readFile(path.join(repo.root, ".git/index")), beforeIndex);
  assert.equal(repo.git("status", "--porcelain=v1"), beforeStatus);
  assert.equal(repo.git("rev-parse", "HEAD"), second);

  const fromRoot = await discoverTimeline({ cwd: repo.root, fallback: emptyFallback });
  assert.deepEqual(fromRoot.document, result.document);
});

test("orders snapshots by actual commit time, including source-only unversioned commits", async () => {
  const repo = await fixture();
  await repo.write("resolve/worker.py", "print('source only')\n");
  const laterTimestamp = repo.commit("resolve: source without package metadata", "2026-01-04T12:00:00+00:00");
  await repo.write("resolve/pyproject.toml", project("0.1.0"));
  const earlierTimestamp = repo.commit("resolve: package metadata", "2026-01-03T12:00:00+00:00");
  const result = await discoverTimeline({ cwd: repo.root, fallback: emptyFallback });
  assert.equal(result.source, "git");
  assert.deepEqual(result.document.versions.map((version) => version.commit), [earlierTimestamp, laterTimestamp]);
  assert.deepEqual(result.document.versions.map((version) => version.framework.version), ["0.1.0", "unversioned"]);
});

test("verified seed metadata stays identical to exports and is compatible with immutable merging", async () => {
  const repo = await fixture();
  await repo.write("resolve/pyproject.toml", project("0.1.0"));
  const commit = repo.commit("resolve: actual source commit subject", "2026-01-02T12:00:00+00:00");
  const seed = structuredClone(initialTimeline.versions[0]);
  seed.id = commit;
  seed.commit = commit;
  seed.createdAt = repo.git("show", "-s", "--format=%cI", commit);
  const fallback: TimelineDocument = { schemaVersion: 1, versions: [seed] };

  const result = await discoverTimeline({ cwd: repo.root, fallback });
  assert.equal(result.source, "git");
  assert.deepEqual(result.document, fallback);
  assert.deepEqual(mergeTimeline(fallback, result.document), fallback);
  assert.equal(result.document.versions[0].title, "Financial backbone");
  assert.equal(result.document.versions[0].label, "v1");
  assert.equal(Object.hasOwn(result.document.versions[0].framework.config, "requiresPython"), false);
  assert.deepEqual(result.document.versions[0].runs, []);
});

test("a seed with mismatched committed name, version, timestamp, or ID is not used as verified metadata", async () => {
  const repo = await fixture();
  await repo.write("resolve/pyproject.toml", project("0.1.0"));
  const commit = repo.commit("resolve: actual metadata", "2026-01-02T12:00:00+00:00");
  const createdAt = repo.git("show", "-s", "--format=%cI", commit);
  for (const mismatch of ["name", "version", "timestamp", "id"] as const) {
    const seed = structuredClone(initialTimeline.versions[0]);
    seed.id = commit;
    seed.commit = commit;
    seed.createdAt = createdAt;
    if (mismatch === "name") seed.framework.name = "different-package";
    if (mismatch === "version") seed.framework.version = "9.9.9";
    if (mismatch === "timestamp") seed.createdAt = "2026-01-10T12:00:00Z";
    if (mismatch === "id") seed.id = "different-snapshot-id";

    const result = await discoverTimeline({ cwd: repo.root, fallback: { schemaVersion: 1, versions: [seed] } });
    assert.equal(result.source, "git", mismatch);
    const actual = result.document.versions[0];
    assert.equal(actual.id, commit, mismatch);
    assert.equal(actual.title, "resolve: actual metadata", mismatch);
    assert.equal(actual.createdAt, createdAt, mismatch);
    assert.equal(actual.framework.name, "mirror-resolve", mismatch);
    assert.equal(actual.framework.version, "0.1.0", mismatch);
    assert.deepEqual(actual.framework.config, { requiresPython: ">=3.11" }, mismatch);
    assert.deepEqual(actual.scenarios, [], mismatch);
    assert.deepEqual(actual.runs, [], mismatch);
  }
});

test("an empty resolve history returns no invented snapshots", async () => {
  const repo = await fixture();
  const result = await discoverTimeline({ cwd: repo.root });
  assert.equal(result.source, "git");
  assert.deepEqual(result.document.versions, []);
});

test("a framework removal does not create a nonexistent source snapshot", async () => {
  const repo = await fixture();
  await repo.write("resolve/pyproject.toml", project("0.1.0"));
  const original = repo.commit("resolve: initial framework", "2026-01-02T12:00:00+00:00");
  await rm(path.join(repo.root, "resolve"), { recursive: true });
  repo.commit("remove framework", "2026-01-03T12:00:00+00:00");
  const result = await discoverTimeline({ cwd: repo.root, fallback: emptyFallback });
  assert.equal(result.source, "git");
  assert.deepEqual(result.document.versions.map((version) => version.commit), [original]);
});

test("fallback contains verified bundled data without leaking filesystem or command errors", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "hyper-timeline-deployment-")));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, "web/studio"), { recursive: true });
  const result = await discoverTimeline({ cwd: root });
  assert.equal(result.source, "bundled");
  assert.deepEqual(result.document, initialTimeline);
  assert.match(result.notice ?? "", /verified bundled snapshots/);
  assert.equal(JSON.stringify(result).includes(root), false);
  assert.equal(JSON.stringify(result).includes("fatal:"), false);
});

test("does not follow a symlinked web project into an unrelated repository", async () => {
  const repo = await fixture();
  const other = await realpath(await mkdtemp(path.join(tmpdir(), "hyper-timeline-other-")));
  temporaryDirectories.push(other);
  await mkdir(path.join(other, "web"));
  await symlink(repo.studio, path.join(other, "web/studio"));
  const result = await discoverTimeline({ cwd: other, fallback: emptyFallback });
  assert.equal(result.source, "bundled");
  assert.deepEqual(result.document.versions, []);
});

test("rejects malformed fallback documents rather than serving unchecked data", async () => {
  await assert.rejects(discoverTimeline({ fallback: { schemaVersion: 99, versions: [] } as unknown as TimelineDocument }));
});
