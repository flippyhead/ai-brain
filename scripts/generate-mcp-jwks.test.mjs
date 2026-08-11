import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = new URL("./generate-mcp-jwks.mjs", import.meta.url).pathname;

function environmentFromFile(path) {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .trim()
      .split(/\r?\n/u)
      .map((line) => {
        const separator = line.indexOf("=");
        const name = line.slice(0, separator);
        let value = line.slice(separator + 1);
        if (value.startsWith("'") && value.endsWith("'")) {
          value = value.slice(1, -1);
        }
        return [name, value];
      }),
  );
}

test("writes secrets to an env file without printing their values", () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-brain-jwks-"));
  const envFile = join(directory, ".env.local");
  writeFileSync(
    envFile,
    [
      "NEXT_PUBLIC_CONVEX_URL=https://example.convex.cloud",
      "MCP_JWT_ISSUER=https://example.vercel.app",
      "MCP_JWT_KEY_ID=",
      "MCP_JWT_PRIVATE_JWK=",
      "MCP_JWT_PUBLIC_JWK=",
      "MCP_OAUTH_ENCRYPTION_KEY=",
      "",
    ].join("\n"),
  );

  try {
    const result = spawnSync(
      process.execPath,
      [script, "--", "--env-file", envFile],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);

    const environment = environmentFromFile(envFile);
    assert.equal(
      result.stdout,
      `Configured MCP_JWT_KEY_ID, MCP_JWT_PRIVATE_JWK, MCP_JWT_PUBLIC_JWK, MCP_OAUTH_ENCRYPTION_KEY in ${envFile}\n`,
    );
    assert.match(environment.MCP_JWT_KEY_ID, /^mcp-/u);
    assert.equal(environment.MCP_OAUTH_ENCRYPTION_KEY.length, 43);

    const privateJwk = JSON.parse(environment.MCP_JWT_PRIVATE_JWK);
    const publicJwk = JSON.parse(environment.MCP_JWT_PUBLIC_JWK);
    assert.equal(privateJwk.crv, "P-256");
    assert.equal(publicJwk.crv, "P-256");
    assert.equal(privateJwk.x, publicJwk.x);
    assert.equal(privateJwk.y, publicJwk.y);
    assert.ok(privateJwk.d);
    assert.equal(publicJwk.d, undefined);

    const beforeSecondRun = readFileSync(envFile, "utf8");
    const secondRun = spawnSync(
      process.execPath,
      [script, "--env-file", envFile],
      { encoding: "utf8" },
    );
    assert.notEqual(secondRun.status, 0);
    assert.match(secondRun.stderr, /already configured/u);
    assert.equal(readFileSync(envFile, "utf8"), beforeSecondRun);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
