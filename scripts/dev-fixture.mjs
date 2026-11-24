// `npm run dev:fixture` — run the app offline on recorded real API responses.
import { spawn } from "node:child_process";

const child = spawn("npx", ["next", "dev", "-p", process.env.PORT ?? "3000"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, DATA_SOURCE: "fixture" },
});
child.on("exit", (code) => process.exit(code ?? 0));
