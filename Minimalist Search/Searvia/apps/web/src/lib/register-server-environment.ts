export async function registerServerEnvironment() {
  try {
    const { parseServerEnvironment } = await import("@searvia/config/server");
    parseServerEnvironment(process.env);
  } catch (error) {
    // Next reports instrumentation errors but can leave the HTTP listener alive.
    // Invalid production configuration must terminate before serving traffic.
    setTimeout(() => process.exit(1), 10);
    throw error;
  }
}
