import { spawn } from "node:child_process";
import { cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const rootEnvironmentFile = fileURLToPath(new URL("../../../.env", import.meta.url));

try {
  process.loadEnvFile(rootEnvironmentFile);
} catch (error) {
  if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}

const nextArguments = process.argv.slice(2);
const nextCommand = nextArguments[0];
const environment = {
  ...process.env,
  HOSTNAME: process.env.HOSTNAME ?? "0.0.0.0",
  NODE_ENV: nextCommand === "dev" ? "development" : "production",
};
const nextBinary = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const standaloneServer = fileURLToPath(
  new URL("../.next/standalone/apps/web/server.js", import.meta.url),
);
const standaloneWorkingDirectory = fileURLToPath(
  new URL("../.next/standalone/apps/web/", import.meta.url),
);
const childArguments =
  nextCommand === "start" ? [standaloneServer] : [nextBinary, ...nextArguments];
const child = spawn(process.execPath, childArguments, {
  cwd: nextCommand === "start" ? standaloneWorkingDirectory : undefined,
  env: environment,
  stdio: "inherit",
});

const result = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => resolve({ code, signal }));
});

if (result.signal) {
  console.error(`Next.js stopped by ${result.signal}.`);
  process.exitCode = 1;
} else if (result.code !== 0) {
  process.exitCode = result.code ?? 1;
} else if (nextCommand === "build") {
  await Promise.all([
    cp(
      new URL("../.next/static/", import.meta.url),
      new URL("../.next/standalone/apps/web/.next/static/", import.meta.url),
      {
        force: true,
        recursive: true,
      },
    ),
    cp(
      new URL("../public/", import.meta.url),
      new URL("../.next/standalone/apps/web/public/", import.meta.url),
      {
        force: true,
        recursive: true,
      },
    ),
  ]);
}
