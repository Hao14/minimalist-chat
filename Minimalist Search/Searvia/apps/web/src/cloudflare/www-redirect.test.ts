import { describe, expect, it } from "vitest";

import redirectWorker from "./www-redirect";

describe("www redirect Worker", () => {
  it("preserves the path and query while redirecting to the canonical HTTPS origin", async () => {
    const response = await redirectWorker.fetch(
      new Request("http://www.searvia.online/features/site-audit?source=www"),
    );

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(
      "https://searvia.online/features/site-audit?source=www",
    );
  });
});
