/**
 * Verification evidence archive on an Archil disk.
 *
 * Optional Node tooling — not part of the application bundle and not part of the vitest
 * suite. The app itself stays static and offline; this script is how a verification
 * session carries its evidence out of the browser and into a disk that survives between
 * runs. Exported artifacts (run records, convergence artifacts, manifests, reports) are
 * uploaded under a per-run key, so a later session can list, restore and compare what an
 * earlier session actually produced instead of starting from an empty `artifacts/`.
 *
 * `exec` runs a command in a microVM with the disk mounted as the working directory, so
 * files and an installed toolchain persist across invocations.
 *
 * Credentials come from the environment only:
 *   ARCHIL_API_KEY    required, account-level control-plane key
 *   ARCHIL_REGION     optional, one of aws-us-east-1 (default), aws-us-west-2,
 *                     aws-eu-west-1, gcp-us-central1
 *   ARCHIL_DISK_NAME  optional, default orbital-trace-labs-evidence
 *   ARCHIL_DISK_ID    optional, use this existing disk instead of looking up by name
 *
 * Usage (the npm script loads .env.local if it exists):
 *   npm run archil -- status
 *   npm run archil -- push [dir]            archive a directory, default `artifacts`
 *   npm run archil -- list [prefix]         list archived runs
 *   npm run archil -- pull <run-id> [dir]   restore one archived run, default `artifacts`
 *   npm run archil -- exec "<command>"      run a command on the disk
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

import * as archil from "disk";

const DISK_NAME = process.env.ARCHIL_DISK_NAME || "orbital-trace-labs-evidence";
const REGION = process.env.ARCHIL_REGION || "aws-us-east-1";

function configure() {
  const apiKey = process.env.ARCHIL_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ARCHIL_API_KEY is not set. Create an Archil API key and put ARCHIL_API_KEY=... in " +
        ".env.local (git-ignored), then rerun `npm run archil -- <command>`.",
    );
  }
  archil.configure({ apiKey, region: REGION });
}

async function openDisk() {
  if (process.env.ARCHIL_DISK_ID) return archil.getDisk(process.env.ARCHIL_DISK_ID);
  const existing = await archil.listDisks({ name: DISK_NAME });
  const match = existing.find((d) => d.name === DISK_NAME);
  if (match) return match;
  const { disk } = await archil.createDisk({ name: DISK_NAME });
  console.log(`created disk ${disk.name} (${disk.id}) in ${disk.region}`);
  return disk;
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function toKeyPath(path) {
  return path.split(sep).join("/");
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function push(disk, source = "artifacts") {
  const files = await listFiles(source);
  if (files.length === 0) throw new Error(`nothing to archive: ${source} is empty`);

  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${source.replace(/[^\w.-]+/g, "-")}`;
  const entries = [];
  for (const file of files) {
    const path = toKeyPath(relative(source, file));
    const bytes = await readFile(file);
    const { etag } = await disk.putObject(`runs/${runId}/files/${path}`, bytes);
    entries.push({ path, bytes: bytes.byteLength, sha256: digest(bytes), etag });
  }

  // The manifest records what was archived and how it was hashed; it is evidence, not a
  // correctness claim about the archived results.
  const manifest = {
    schemaVersion: "otl-archil-archive-v1",
    runId,
    archivedAt: new Date().toISOString(),
    sourceDirectory: source.replace(/[\\/]+$/, ""),
    disk: { id: disk.id, name: disk.name, region: disk.region },
    files: entries,
  };
  await disk.putObject(
    `runs/${runId}/manifest.json`,
    JSON.stringify(manifest, null, 2),
    "application/json",
  );

  const bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  console.log(`archived ${entries.length} files (${bytes} bytes) as run ${runId}`);
  for (const entry of entries) console.log(`  ${entry.path}  ${entry.sha256.slice(0, 12)}`);
}

async function list(disk, prefix = "runs/") {
  const manifests = await disk.listObjects(prefix, { recursive: true });
  if (manifests.objects.length === 0) {
    console.log(`no objects under ${prefix} on ${disk.name}`);
    return;
  }
  for (const object of manifests.objects) {
    const when = object.lastModified ? object.lastModified.toISOString() : "unknown time";
    console.log(`${when}  ${String(object.size).padStart(9)} B  ${object.key}`);
  }
}

async function pull(disk, runId, target = "artifacts") {
  const manifestKey = `runs/${runId}/manifest.json`;
  const raw = await disk.getObject(manifestKey);
  const manifest = JSON.parse(new TextDecoder().decode(raw));
  let restored = 0;
  for (const entry of manifest.files) {
    const bytes = await disk.getObject(`runs/${runId}/files/${entry.path}`);
    const actual = digest(bytes);
    if (actual !== entry.sha256) {
      throw new Error(`${entry.path} does not match its archived digest (${actual})`);
    }
    const destination = join(target, ...entry.path.split("/"));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    restored += 1;
  }
  console.log(`restored ${restored} files from ${runId} into ${target}`);
}

async function status(disk) {
  const all = await disk.listObjects("runs/", { recursive: true });
  const archived = all.objects.filter((object) => object.key.endsWith("/manifest.json"));
  const bytes = all.objects.reduce((sum, object) => sum + object.size, 0);
  console.log(`disk        ${disk.name} (${disk.id})`);
  console.log(`region      ${disk.region}`);
  console.log(`status      ${disk.status}`);
  console.log(`runs        ${archived.length}`);
  console.log(`objects     ${all.objects.length} (${bytes} bytes)`);
  console.log(`last run    ${archived.at(-1)?.key ?? "none"}`);
}

async function run(disk, command) {
  if (!command) throw new Error('exec needs a command, e.g. `npm run archil -- exec "ls -la"`');
  const result = await disk.exec(command);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  console.log(`exit ${result.exitCode} in ${result.timing.executeMs}ms`);
  if (result.exitCode !== 0) process.exitCode = 1;
}

const USAGE = `usage: npm run archil -- <command>

  status                  disk identity and what it already holds
  push [dir]              archive a directory (default: artifacts)
  list [prefix]           list archived objects (default: runs/)
  pull <run-id> [dir]     restore one archived run (default: artifacts)
  exec "<command>"        run a command on the disk, toolchain persists between runs`;

async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help") {
    console.log(USAGE);
    return;
  }
  configure();
  const disk = await openDisk();
  switch (command) {
    case "status":
      return status(disk);
    case "push":
      return push(disk, rest[0]);
    case "list":
      return list(disk, rest[0]);
    case "pull":
      if (!rest[0]) throw new Error("pull needs a run id; see `list`");
      return pull(disk, rest[0], rest[1]);
    case "exec":
      return run(disk, rest.join(" "));
    default:
      throw new Error(`unknown command "${command}"\n\n${USAGE}`);
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`archil-evidence: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
