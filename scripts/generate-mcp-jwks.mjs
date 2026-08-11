import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
let envFile;

for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--") {
    continue;
  }
  if (argument === "--env-file") {
    envFile = args[index + 1];
    if (!envFile) {
      throw new Error("--env-file requires a path");
    }
    index += 1;
    continue;
  }
  if (argument === "--help") {
    process.stdout.write(
      "Usage: node scripts/generate-mcp-jwks.mjs [--env-file <path>]\n",
    );
    process.exit(0);
  }
  throw new Error(`Unknown argument: ${argument}`);
}

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
});

const privateJwk = privateKey.export({ format: "jwk" });
const publicJwk = publicKey.export({ format: "jwk" });
const keyId = `mcp-${randomUUID()}`;
const oauthEncryptionKey = randomBytes(32).toString("base64url");
const generatedValues = new Map([
  ["MCP_JWT_KEY_ID", keyId],
  ["MCP_JWT_PRIVATE_JWK", `'${JSON.stringify(privateJwk)}'`],
  ["MCP_JWT_PUBLIC_JWK", `'${JSON.stringify(publicJwk)}'`],
  ["MCP_OAUTH_ENCRYPTION_KEY", oauthEncryptionKey],
]);

if (envFile) {
  const original = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const lines = original.split(/\r?\n/u);
  const seen = new Set();

  const updated = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
    if (!match || !generatedValues.has(match[1])) {
      return line;
    }
    const [, name, currentValue] = match;
    seen.add(name);
    if (currentValue.trim()) {
      throw new Error(
        `${name} is already configured in ${envFile}; clear it explicitly before generating a replacement`,
      );
    }
    return `${name}=${generatedValues.get(name)}`;
  });

  for (const [name, value] of generatedValues) {
    if (!seen.has(name)) {
      updated.push(`${name}=${value}`);
    }
  }

  writeFileSync(envFile, `${updated.join("\n").replace(/\n+$/u, "")}\n`, {
    mode: 0o600,
  });
  chmodSync(envFile, 0o600);
  process.stdout.write(
    `Configured ${[...generatedValues.keys()].join(", ")} in ${envFile}\n`,
  );
  process.exit(0);
}

process.stdout.write(
  [...generatedValues].map(([name, value]) => `${name}=${value}`).join("\n") +
    "\n",
);
