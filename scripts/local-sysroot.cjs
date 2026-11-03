/**
 * Workspace-local sysroot builder for headless Chromium (no root available).
 * Downloads Ubuntu .deb files from the archive and extracts them under .cache/sysroot.
 * Resolves missing shared libraries by name using the Contents index.
 * This is environment tooling only; it is not part of the application.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ROOT = process.cwd();
const SYSROOT = path.join(ROOT, ".cache/sysroot");
const DEBS = path.join(ROOT, ".cache/debs");
const BROWSER = path.join(
  ROOT,
  ".cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell",
);
const BASE = "http://archive.ubuntu.com/ubuntu";
const SUITES = ["noble", "noble-updates"];
const COMPONENTS = ["main", "universe"];
const ARCH = "amd64";

fs.mkdirSync(SYSROOT, { recursive: true });
fs.mkdirSync(DEBS, { recursive: true });

async function fetchBuf(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function loadPackages() {
  const map = new Map(); // package name -> {filename, version, depends}
  for (const suite of SUITES) {
    for (const comp of COMPONENTS) {
      const url = `${BASE}/dists/${suite}/${comp}/binary-${ARCH}/Packages.gz`;
      let buf;
      try {
        buf = await fetchBuf(url);
      } catch {
        continue;
      }
      const text = zlib.gunzipSync(buf).toString("utf8");
      for (const stanza of text.split("\n\n")) {
        if (!stanza.includes("Package: ")) continue;
        const get = (key) => {
          const m = stanza.match(new RegExp(`^${key}: (.*)$`, "m"));
          return m ? m[1].trim() : null;
        };
        const name = get("Package");
        if (!name) continue;
        map.set(name, { filename: get("Filename"), depends: get("Depends") ?? "" });
      }
    }
  }
  return map;
}

async function loadContents() {
  const map = new Map(); // basename -> package
  for (const comp of COMPONENTS) {
    for (const suite of SUITES) {
      const url = `${BASE}/dists/${suite}/${comp}/Contents-${ARCH}.gz`;
      let buf;
      try {
        buf = await fetchBuf(url);
      } catch {
        continue;
      }
      for (const line of zlib.gunzipSync(buf).toString("utf8").split("\n")) {
        const idx = line.indexOf(" ");
        if (idx < 0) continue;
        const pkgSection = line.slice(idx + 1).trim();
        const pkg = pkgSection.split("/").pop();
        const base = line.slice(0, idx).split("/").pop();
        if (base && !map.has(base)) map.set(base, pkg);
      }
      console.log(`contents index loaded: ${suite}/${comp}`);
      return map; // one Contents file is enough
    }
  }
  return map;
}

const LIBPATH = [
  path.join(SYSROOT, "usr/lib/x86_64-linux-gnu"),
  path.join(SYSROOT, "lib/x86_64-linux-gnu"),
  path.join(SYSROOT, "usr/lib"),
].join(":");

function lddMissing() {
  const out = execFileSync("ldd", [BROWSER], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, LD_LIBRARY_PATH: LIBPATH },
  });
  const missing = [];
  for (const line of out.split("\n")) {
    const m = line.match(/(\S+) => not found/);
    if (m) missing.push(m[1]);
  }
  return [...new Set(missing)];
}

function extractDeb(file) {
  const target = path.join(DEBS, path.basename(file));
  if (!fs.existsSync(target)) {
    execFileSync("curl", ["-fsSL", `${BASE}/${file}`, "-o", target], { stdio: "inherit" });
  }
  execFileSync("dpkg-deb", ["-x", target, SYSROOT], { stdio: "inherit" });
}

(async () => {
  const packages = await loadPackages();
  console.log("package index entries:", packages.size);
  let missing = lddMissing();
  console.log("missing round 0:", missing);
  // Direct soname -> Ubuntu 24.04 package candidates (checked against the index).
  const CANDIDATES = {
    "libnspr4.so": ["libnspr4"],
    "libnss3.so": ["libnss3"],
    "libnssutil3.so": ["libnss3"],
    "libsmime3.so": ["libnss3"],
    "libatk-1.0.so.0": ["libatk1.0-0t64", "libatk1.0-0"],
    "libatk-bridge-2.0.so.0": ["libatk-bridge2.0-0t64", "libatk-bridge2.0-0"],
    "libatspi.so.0": ["libatspi2.0-0t64", "libatspi2.0-0"],
    "libXcomposite.so.1": ["libxcomposite1"],
    "libXdamage.so.1": ["libxdamage1t64", "libxdamage1"],
    "libXfixes.so.3": ["libxfixes3t64", "libxfixes3"],
    "libXrandr.so.2": ["libxrandr2t64", "libxrandr2"],
    "libxkbcommon.so.0": ["libxkbcommon0t64", "libxkbcommon0"],
    "libasound.so.2": ["libasound2t64", "libasound2"],
    "libcups.so.2": ["libcups2t64", "libcups2"],
    "libfontconfig.so.1": ["libfontconfig1"],
    "libfreetype.so.6": ["libfreetype6"],
    "libpango-1.0.so.0": ["libpango-1.0-0"],
    "libcairo.so.2": ["libcairo2"],
    "libXrender.so.1": ["libxrender1t64", "libxrender1"],
    "libXi.so.6": ["libxi6t64", "libxi6"],
    "libxcb-shm.so.0": ["libxcb1"],
    "libxcb-render.so.0": ["libxcb1"],
    "libpixman-1.so.0": ["libpixman-1-0"],
    "libpng16.so.16": ["libpng16-16t64", "libpng16-16"],
  };

  for (let round = 1; round <= 5 && missing.length > 0; round++) {
    const wanted = new Set();
    for (const lib of missing) {
      const cands = CANDIDATES[lib] ?? [];
      const pkg = cands.find((c) => packages.has(c));
      if (!pkg) {
        console.log(`  no owner found for ${lib}`);
        continue;
      }
      // Resolve the owning package and its direct dependencies that own libraries.
      const queue = [pkg];
      const seen = new Set();
      while (queue.length) {
        const name = queue.shift();
        if (seen.has(name)) continue;
        seen.add(name);
        wanted.add(name);
        const meta = packages.get(name);
        if (!meta) continue;
        for (const dep of meta.depends.split(",").map((d) => d.trim().split(" ")[0].split(":")[0])) {
          if (!dep || dep.startsWith("libc6") || dep === "libc6" || dep.includes("${")) continue;
          if (packages.has(dep)) queue.push(dep);
        }
      }
    }
    console.log(`round ${round}: installing ${[...wanted].join(", ")}`);
    for (const name of wanted) {
      const meta = packages.get(name);
      if (!meta || !meta.filename) {
        console.log(`  skip ${name} (no filename)`);
        continue;
      }
      try {
        extractDeb(meta.filename);
      } catch (e) {
        console.log(`  failed ${name}: ${e.message}`);
      }
    }
    missing = lddMissing();
    console.log(`missing after round ${round}:`, missing);
  }

  const libdir = path.join(SYSROOT, "usr/lib/x86_64-linux-gnu");
  console.log("sysroot libs:", fs.existsSync(libdir) ? fs.readdirSync(libdir).length : 0);
  console.log(missing.length === 0 ? "ALL LIBRARIES RESOLVED" : "STILL MISSING: " + missing.join(", "));
})().catch((e) => {
  console.error("SYSROOT BUILD FAILED:", e);
  process.exit(1);
});
