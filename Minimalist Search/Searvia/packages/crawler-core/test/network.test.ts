import {
  createPinnedLookup,
  isBlockedHostname,
  isBlockedIpAddress,
  validateDestination,
  type DnsAddress,
  type DnsResolver,
} from "../src/index.js";
import { describe, expect, it } from "vitest";

describe("crawler destination policy", () => {
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.0.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "64:ff9b::1",
    "100::1",
    "2001:db8::1",
    "2002::1",
    "3fff::1",
    "fc00::1",
    "fe80::1",
    "fec0::1",
    "ff02::1",
  ])("blocks special address %s", (address) => {
    expect(isBlockedIpAddress(address)).toBe(true);
  });

  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])(
    "allows globally routed address %s",
    (address) => {
      expect(isBlockedIpAddress(address)).toBe(false);
    },
  );

  it.each(["localhost", "api.localhost", "metadata.google.internal", "instance-data.ec2.internal"])(
    "blocks special hostname %s",
    (hostname) => {
      expect(isBlockedHostname(hostname)).toBe(true);
    },
  );

  it("rejects a hostname if any DNS answer is blocked", async () => {
    const resolver: DnsResolver = {
      lookup: async () => [
        { address: "1.1.1.1", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ],
    };
    await expect(
      validateDestination(new URL("https://example.com/"), resolver, 1_000),
    ).rejects.toMatchObject({ code: "blocked_address" });
  });

  it("pins the validated answer and revalidates a later rebinding answer", async () => {
    const answers: readonly (readonly DnsAddress[])[] = [
      [{ address: "1.1.1.1", family: 4 }],
      [{ address: "127.0.0.1", family: 4 }],
    ];
    let call = 0;
    const resolver: DnsResolver = {
      lookup: async () => answers[call++] ?? [],
    };
    const first = await validateDestination(new URL("https://example.com/"), resolver, 1_000);
    const pinned = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      createPinnedLookup(first.addresses)(
        "example.com",
        { all: false, family: 0 },
        (error, address, family) => {
          if (error !== null) reject(error);
          else resolve({ address: String(address), family: family ?? 0 });
        },
      );
    });
    expect(pinned).toEqual({ address: "1.1.1.1", family: 4 });
    await expect(
      validateDestination(new URL("https://example.com/next"), resolver, 1_000),
    ).rejects.toMatchObject({ code: "blocked_address" });
  });

  it("rejects unsafe ports after validating the address", async () => {
    const resolver: DnsResolver = {
      lookup: async () => [{ address: "1.1.1.1", family: 4 }],
    };
    await expect(
      validateDestination(new URL("http://example.com:22/"), resolver, 1_000),
    ).rejects.toMatchObject({ code: "unsafe_port" });
  });

  it("bounds DNS resolution time and reacts to cancellation", async () => {
    const resolver: DnsResolver = {
      lookup: () => new Promise(() => undefined),
    };
    await expect(
      validateDestination(new URL("https://example.com/"), resolver, 10),
    ).rejects.toMatchObject({ code: "dns_timeout" });

    const controller = new AbortController();
    const pending = validateDestination(
      new URL("https://example.com/"),
      resolver,
      1_000,
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });
});
