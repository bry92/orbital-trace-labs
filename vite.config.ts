import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The build identifier is generated at build time and embedded in every run record.
// It is NOT a VCS revision: no repository revision is bound to the bundle, so the
// application reports codeRevisionStatus = "UNVERIFIED".
const buildId = `otl-build-${new Date().toISOString()}`;

export default defineConfig({
  plugins: [react()],
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  server: { host: "0.0.0.0", port: 3000, strictPort: true },
  preview: { host: "0.0.0.0", port: 3000 },
});
