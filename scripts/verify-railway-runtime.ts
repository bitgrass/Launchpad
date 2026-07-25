import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";

function delay(milliseconds: number) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

async function waitForHealth(url: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.status === 200) return response;
    } catch {
      // The production server may still be binding its port.
    }
    await delay(250);
  }
  throw new Error("Railway-style production server did not become healthy");
}

const storageRoot = await mkdtemp(join(tmpdir(), "hoodiepad-railway-smoke-"));
const port = await availablePort();
const output: string[] = [];
const server = spawn(
  process.execPath,
  [resolve("node_modules/vinext/dist/cli.js"), "start"],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      RAILWAY_VOLUME_MOUNT_PATH: storageRoot,
      VINEXT_TRUST_PROXY: "1",
      VINEXT_TRUSTED_HOSTS: "hoodiepad-production.up.railway.app",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);

server.stdout.on("data", (chunk) => output.push(String(chunk)));
server.stderr.on("data", (chunk) => output.push(String(chunk)));

try {
  const origin = `http://127.0.0.1:${port}`;
  const healthResponse = await waitForHealth(`${origin}/api/health`);
  assert.deepEqual(await healthResponse.json(), {
    status: "ok",
    service: "hoodiepad",
    storage: "filesystem",
  });

  const artworkBytes = new Uint8Array([137, 80, 78, 71, 13, 10]);
  const uploadResponse = await fetch(`${origin}/api/artwork`, {
    method: "POST",
    headers: {
      "content-type": "image/png",
      "x-hoodiepad-artwork-name": "railway-smoke.png",
      "x-forwarded-host": "hoodiepad-production.up.railway.app",
      "x-forwarded-proto": "https",
    },
    body: artworkBytes,
  });
  assert.equal(uploadResponse.status, 200);
  const uploaded = await uploadResponse.json() as { key: string; url: string };
  assert.match(
    uploaded.url,
    /^https:\/\/hoodiepad-production\.up\.railway\.app\/api\/artwork\?key=/,
  );

  const artworkResponse = await fetch(
    `${origin}/api/artwork?key=${encodeURIComponent(uploaded.key)}`,
  );
  assert.equal(artworkResponse.status, 200);
  assert.equal(artworkResponse.headers.get("content-type"), "image/png");
  assert.deepEqual(
    new Uint8Array(await artworkResponse.arrayBuffer()),
    artworkBytes,
  );

  console.log(`Railway runtime PASSED on port ${port}`);
  console.log(`Storage backend filesystem`);
  console.log(`Proxy-aware URL ${uploaded.url}`);
} catch (error) {
  process.stderr.write(output.join("").slice(-8_000));
  throw error;
} finally {
  if (server.exitCode === null && server.signalCode === null) {
    const exit = once(server, "exit");
    server.kill();
    await Promise.race([exit, delay(2_000)]);
  }
  if (server.exitCode === null && server.signalCode === null) {
    const forcedExit = once(server, "exit");
    server.kill("SIGKILL");
    await Promise.race([forcedExit, delay(2_000)]);
  }
  await rm(storageRoot, { recursive: true, force: true });
}
