import { Component, type ErrorInfo, type ReactNode } from "react";
import { diagnosticsAsText, diagnosticsSnapshot, recordDiagnostic } from "./diagnostics";

interface Props {
  children: ReactNode;
  /** Label recorded with the entry, so a failure can be attributed to a section. */
  view: string;
}

interface State {
  error: Error | null;
  copyState: "idle" | "copied" | "unavailable";
}

/**
 * Catches render-time exceptions so a single failing section shows a reported error
 * instead of a blank page, and records a bounded diagnostic entry without any
 * application data. It deliberately does not retry or "recover": the section stays
 * failed until the user reloads or navigates away.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, copyState: "idle" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    recordDiagnostic({
      view: this.props.view,
      kind: "render",
      message: error.message,
      stack: `${error.stack ?? ""}\n${info.componentStack ?? ""}`,
    });
  }

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(diagnosticsAsText());
      this.setState({ copyState: "copied" });
    } catch {
      this.setState({ copyState: "unavailable" });
    }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const count = diagnosticsSnapshot().length;
    return (
      <section className="panel" style={{ margin: "16px 0" }}>
        <div className="panel-head">
          <div>
            <div className="panel-eyebrow">Interface error</div>
            <h2 className="panel-title">This section failed to render</h2>
          </div>
        </div>
        <div className="issues">
          <div className="issue">
            <strong>{this.props.view}</strong> — {this.state.error.message}
          </div>
          <div className="issue warning">
            {count === 1 ? "1 diagnostic entry" : `${count} diagnostic entries`} recorded in this session. The entry holds the
            message, stack and section only — no run records, inputs or stored data. Nothing was sent anywhere.
          </div>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => void this.copy()}>
            {this.state.copyState === "copied" ? "Copied" : "Copy diagnostics"}
          </button>
          <button className="btn ghost" onClick={() => window.location.reload()}>
            Reload application
          </button>
          {this.state.copyState === "unavailable" && (
            <span className="small muted">Clipboard unavailable; the message above is the diagnostic.</span>
          )}
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          Results already stored in this browser are unaffected. No verification state has been changed by this error.
        </p>
      </section>
    );
  }
}
