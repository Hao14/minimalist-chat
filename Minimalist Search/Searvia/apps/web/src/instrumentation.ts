export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { registerServerEnvironment } = await import("./lib/register-server-environment");
  await registerServerEnvironment();
}
