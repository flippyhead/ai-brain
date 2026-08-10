import { generateKeyPairSync, randomUUID } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
});

const privateJwk = privateKey.export({ format: "jwk" });
const publicJwk = publicKey.export({ format: "jwk" });
const keyId = `mcp-${randomUUID()}`;

process.stdout.write(
  [
    `MCP_JWT_KEY_ID=${keyId}`,
    `MCP_JWT_PRIVATE_JWK='${JSON.stringify(privateJwk)}'`,
    `MCP_JWT_PUBLIC_JWK='${JSON.stringify(publicJwk)}'`,
  ].join("\n") + "\n",
);
