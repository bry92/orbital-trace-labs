import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { installGlobalErrorHandlers } from "./ui/diagnostics";

// Records interface exceptions into a bounded in-memory log; sends nothing anywhere.
installGlobalErrorHandlers();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary view="application">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
