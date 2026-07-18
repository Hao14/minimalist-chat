import { spawn } from "node:child_process";

try {
  process.loadEnvFile(".env");
} catch (error) {
  if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}

const environment = {
  ...process.env,
  NODE_ENV: "production",
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
};

const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
const args =
  process.platform === "win32"
    ? ["/d", "/s", "/c", "pnpm exec turbo run build"]
    : ["exec", "turbo", "run", "build"];

const child = spawn(command, args, {
  env: environment,
  stdio: "inherit",
});

child.once("error", (error) => {
  console.error("Unable to start the workspace build.", error);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`Workspace build stopped by ${signal}.`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = code ?? 1;
});
