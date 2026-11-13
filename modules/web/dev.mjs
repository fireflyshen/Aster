import { spawn } from "node:child_process";

const backendPort = process.env.ASTER_BACKEND_PORT || "4181";
const backend = spawn(
  process.execPath,
  ["--experimental-strip-types", "../server/src/index.ts"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "development",
      SSH_TARGET: process.env.SSH_TARGET ?? "dmit",
      HOST: "127.0.0.1",
      PORT: backendPort,
      PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN || "http://localhost:4180",
    },
  },
);

const frontend = spawn(process.execPath, ["./node_modules/vite/bin/vite.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    ASTER_BACKEND_PORT: backendPort,
  },
});

let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  backend.kill("SIGTERM");
  frontend.kill("SIGTERM");
  process.exitCode = code;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}

backend.on("exit", (code) => {
  if (!closing) shutdown(code ?? 1);
});

frontend.on("exit", (code) => {
  if (!closing) shutdown(code ?? 0);
});
