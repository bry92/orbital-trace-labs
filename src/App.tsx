import { useEffect, useState } from "react";
import {
  APP_CLASSIFICATION,
  APP_NAME,
  APP_RELEASE_LABEL,
  BUILD_ID,
  CODE_REVISION_STATUS,
  DISCLAIMER,
} from "./core/constants";
import type { RunRecord } from "./core/run";
import { appendRun, loadRuns, storageSizeBytes } from "./storage/runStore";
import { EVIDENCE_REGISTER } from "./evidence/register";
import { Dashboard } from "./ui/Dashboard";
import { Laboratory } from "./ui/Laboratory";
import { Registry } from "./ui/Registry";
import { VerificationCenter } from "./ui/VerificationCenter";
import { Evidence } from "./ui/Evidence";
import { Compare } from "./ui/Compare";
import { About } from "./ui/About";
import { Reconstruction } from "./ui/Reconstruction";

type TabId = "dashboard" | "laboratory" | "reconstruction" | "registry" | "verification" | "evidence" | "compare" | "about";

const TABS: { id: TabId; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "laboratory", label: "Laboratory" },
  { id: "reconstruction", label: "TSS Reconstruction" },
  { id: "registry", label: "Models" },
  { id: "verification", label: "Verification" },
  { id: "evidence", label: "Evidence" },
  { id: "compare", label: "Compare" },
  { id: "about", label: "About" },
];

export default function App() {
  const [tab, setTab] = useState<TabId>("dashboard");
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [storeNotice, setStoreNotice] = useState<string | null>(null);
  const [storageBytes, setStorageBytes] = useState<number | null>(null);

  useEffect(() => {
    const loaded = loadRuns();
    setRuns(loaded.runs);
    setSelectedRunId(loaded.runs[loaded.runs.length - 1]?.runId ?? null);
    if (loaded.error) setStoreNotice(loaded.error);
    setStorageBytes(storageSizeBytes());
  }, []);

  function handleRunCreated(run: RunRecord) {
    const res = appendRun(run);
    setRuns((prev) => (prev.some((r) => r.runId === run.runId) ? prev : [...prev, run]));
    setSelectedRunId(run.runId);
    setStorageBytes(storageSizeBytes());
    if (!res.ok) setStoreNotice(res.error);
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              OTL
            </div>
            <div>
              <div className="brand-title">{APP_NAME}</div>
              <div className="brand-sub">
                {APP_RELEASE_LABEL} · {APP_CLASSIFICATION}
              </div>
            </div>
          </div>
          <div className="topbar-meta">
            <span className="badge info">build {BUILD_ID.replace("otl-build-", "").slice(0, 19)}</span>
            <span className="badge unresolved">code revision {CODE_REVISION_STATUS}</span>
            <span className="badge neutral">local only · no network</span>
          </div>
        </div>
        <div className="disclaimer-bar">
          <strong>RESEARCH PROTOTYPE — NOT FLIGHT SOFTWARE.</strong> {DISCLAIMER.replace("RESEARCH PROTOTYPE — NOT FLIGHT SOFTWARE. ", "")}
        </div>
        <nav className="tabs" role="tablist" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              className="tab"
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === "evidence" && <span className="count">{EVIDENCE_REGISTER.length}</span>}
              {t.id === "compare" && <span className="count">{runs.length}</span>}
            </button>
          ))}
        </nav>
      </header>

      <main className="shell">
        {storeNotice && (
          <div className="issues" style={{ marginTop: 16 }}>
            <div className="issue warning">
              <strong>STORAGE</strong> — {storeNotice}
            </div>
          </div>
        )}

        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === "dashboard" && (
            <Dashboard
              runs={runs}
              onOpenLab={() => setTab("laboratory")}
              onOpenVerification={() => setTab("verification")}
              onOpenEvidence={() => setTab("evidence")}
            />
          )}
          {tab === "laboratory" && (
            <Laboratory
              runs={runs}
              selectedRunId={selectedRunId}
              onSelectRun={setSelectedRunId}
              onRunCreated={handleRunCreated}
            />
          )}
          {tab === "reconstruction" && <Reconstruction runs={runs} onRunCreated={handleRunCreated} />}
          {tab === "registry" && <Registry />}
          {tab === "verification" && <VerificationCenter runs={runs} selectedRunId={selectedRunId} />}
          {tab === "evidence" && <Evidence />}
          {tab === "compare" && <Compare runs={runs} />}
          {tab === "about" && <About />}
        </div>

        <div className="footnote">
          {APP_NAME} {APP_RELEASE_LABEL} · build {BUILD_ID} · code revision {CODE_REVISION_STATUS} · {runs.length} stored run
          {runs.length === 1 ? "" : "s"}
          {storageBytes !== null ? ` · ${(storageBytes / 1024).toFixed(1)} KiB local storage` : " · storage unavailable"}
          <br />
          All calculations execute in this browser. Hashing covers payload integrity only; it does not establish scientific
          correctness, authorship or physical validity.
        </div>
      </main>
    </>
  );
}
