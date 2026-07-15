import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createGameServer, type GameServer } from "./server";

describe("production static server", () => {
  let server: GameServer | undefined;
  let staticDirectory: string | undefined;

  afterEach(async () => {
    await server?.close();
    if (staticDirectory) await rm(staticDirectory, { recursive: true, force: true });
    server = undefined;
    staticDirectory = undefined;
  });

  it("serves health checks and the SPA for direct invite links", async () => {
    staticDirectory = await mkdtemp(join(tmpdir(), "fengsheng-static-"));
    await writeFile(
      join(staticDirectory, "index.html"),
      "<!doctype html><title>风声</title><main>app shell</main>",
      "utf8",
    );
    server = createGameServer({ staticDirectory });
    await server.listen(0, "127.0.0.1");
    const port = (server.httpServer.address() as AddressInfo).port;
    const origin = `http://127.0.0.1:${port}`;

    const health = await fetch(`${origin}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    const invite = await fetch(`${origin}/ABCDEF`, {
      headers: { accept: "text/html" },
    });
    expect(invite.status).toBe(200);
    expect(await invite.text()).toContain("app shell");

    const missingAsset = await fetch(`${origin}/assets/missing.js`, {
      headers: { accept: "application/javascript" },
    });
    expect(missingAsset.status).toBe(404);
  });
});
