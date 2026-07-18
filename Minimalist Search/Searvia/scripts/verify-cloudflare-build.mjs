import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const outputDirectory = path.resolve("apps/web/out");
const requiredFiles = [
  "404.html",
  "_headers",
  "about.html",
  "api/health",
  "app.html",
  "app/projects.html",
  "app/settings.html",
  "demo.html",
  "features/ai-visibility.html",
  "features/backlinks.html",
  "features/competitor-analysis.html",
  "features/keyword-research.html",
  "features/rank-tracking.html",
  "features/site-audit.html",
  "index.html",
  "login.html",
  "manifest.webmanifest",
  "onboarding.html",
  "robots.txt",
  "signup.html",
  "sitemap.xml",
];
const forbiddenPatterns = [
  /localhost:(?:3000|5432|6379|9000)/i,
  /postgres(?:ql)?:\/\//i,
  /redis:\/\//i,
  /searvia_(?:postgres|mini?o)_local_only/i,
  /DATABASE_URL/,
  /OBJECT_STORAGE_SECRET_KEY/,
];

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? collectFiles(entryPath) : [entryPath];
    }),
  );

  return nestedFiles.flat();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await Promise.all(
  requiredFiles.map(async (relativePath) => {
    await readFile(path.join(outputDirectory, relativePath));
  }),
);

const health = JSON.parse(await readFile(path.join(outputDirectory, "api/health"), "utf8"));
assert(health.status === "ok" && health.service === "web", "Unexpected health payload.");

const robots = await readFile(path.join(outputDirectory, "robots.txt"), "utf8");
assert(
  robots.includes("Sitemap: https://searvia.online/sitemap.xml"),
  "robots.txt does not use the canonical production origin.",
);
for (const privatePath of ["/app", "/demo", "/login", "/onboarding", "/signup"]) {
  assert(
    robots.includes(`Disallow: ${privatePath}`),
    `robots.txt does not disallow ${privatePath}.`,
  );
}

const sitemap = await readFile(path.join(outputDirectory, "sitemap.xml"), "utf8");
assert(sitemap.includes("https://searvia.online"), "sitemap.xml has no canonical origin.");
assert(!sitemap.includes("localhost"), "sitemap.xml contains localhost.");
assert(!sitemap.includes("/login") && !sitemap.includes("/signup"), "Demo auth is indexed.");

const canonicalPages = [
  ["index.html", "https://searvia.online"],
  ["about.html", "https://searvia.online/about"],
  ["contact.html", "https://searvia.online/contact"],
  ["pricing.html", "https://searvia.online/pricing"],
  ["privacy.html", "https://searvia.online/privacy"],
  ["security.html", "https://searvia.online/security"],
  ["terms.html", "https://searvia.online/terms"],
  ["features/ai-visibility.html", "https://searvia.online/features/ai-visibility"],
  ["features/backlinks.html", "https://searvia.online/features/backlinks"],
  ["features/competitor-analysis.html", "https://searvia.online/features/competitor-analysis"],
  ["features/keyword-research.html", "https://searvia.online/features/keyword-research"],
  ["features/rank-tracking.html", "https://searvia.online/features/rank-tracking"],
  ["features/site-audit.html", "https://searvia.online/features/site-audit"],
];

await Promise.all(
  canonicalPages.map(async ([relativePath, canonicalUrl]) => {
    const html = await readFile(path.join(outputDirectory, relativePath), "utf8");
    assert(
      html.includes(`rel="canonical" href="${canonicalUrl}"`),
      `${relativePath} has no self-referential canonical URL.`,
    );
  }),
);

const privatePages = [
  "app.html",
  "app/projects.html",
  "app/settings.html",
  "demo.html",
  "login.html",
  "onboarding.html",
  "signup.html",
];

await Promise.all(
  privatePages.map(async (relativePath) => {
    const html = await readFile(path.join(outputDirectory, relativePath), "utf8");
    assert(
      html.includes('name="robots" content="noindex, nofollow"'),
      `${relativePath} is indexable.`,
    );
    assert(!html.includes('rel="canonical"'), `${relativePath} has a canonical URL.`);
  }),
);

const demo = await readFile(path.join(outputDirectory, "demo.html"), "utf8");
assert(demo.includes("Demo data"), "The exported demo is missing its data disclosure.");

const textExtensions = new Set(["", ".css", ".html", ".js", ".json", ".txt", ".xml"]);
const files = await collectFiles(outputDirectory);
for (const file of files) {
  if (!textExtensions.has(path.extname(file))) continue;
  const content = await readFile(file, "utf8");
  for (const pattern of forbiddenPatterns) {
    assert(
      !pattern.test(content),
      `Forbidden deployment value found in ${path.relative(outputDirectory, file)}.`,
    );
  }
}

console.log(`Verified Cloudflare static export (${files.length} files).`);
