import "server-only";

import crypto from "node:crypto";

import { getMcpIssuer, requireEnvironmentVariable } from "./environment";
import {
  type AuthorizationCodePayload,
  authorizationCodePayloadSchema,
  type ClientRegistrationPayload,
  clientRegistrationPayloadSchema,
} from "./oauth-validation";

const AUTH_CODE_PREFIX = "obac1";
const CLIENT_REGISTRATION_PREFIX = "obcr1";
const MAX_OAUTH_BODY_BYTES = 16 * 1024;
const OAUTH_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function getEncryptionKey(): Buffer {
  const encodedKey = requireEnvironmentVariable("MCP_OAUTH_ENCRYPTION_KEY");
  if (!OAUTH_KEY_PATTERN.test(encodedKey)) {
    throw new Error(
      "MCP_OAUTH_ENCRYPTION_KEY must be a base64url-encoded 32-byte key",
    );
  }

  const key = Buffer.from(encodedKey, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== encodedKey) {
    throw new Error(
      "MCP_OAUTH_ENCRYPTION_KEY must be a base64url-encoded 32-byte key",
    );
  }
  return key;
}

function encryptPayload(prefix: string, payload: object): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  cipher.setAAD(Buffer.from(prefix));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${prefix}.${Buffer.concat([iv, tag, encrypted]).toString("base64url")}`;
}

function decryptPayload(prefix: string, token: string): unknown | null {
  try {
    if (token.length > 8192 || !token.startsWith(`${prefix}.`)) return null;
    const encoded = token.slice(prefix.length + 1);
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;

    const buffer = Buffer.from(encoded, "base64url");
    if (buffer.length < 29) return null;

    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const encrypted = buffer.subarray(28);
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      getEncryptionKey(),
      iv,
    );
    decipher.setAAD(Buffer.from(prefix));
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

export function assertOAuthEncryptionConfigured(): void {
  getEncryptionKey();
}

export function encryptClientRegistration(
  registration: ClientRegistrationPayload,
): string {
  return encryptPayload(CLIENT_REGISTRATION_PREFIX, registration);
}

export function decryptClientRegistration(
  clientId: string,
): ClientRegistrationPayload | null {
  const result = clientRegistrationPayloadSchema.safeParse(
    decryptPayload(CLIENT_REGISTRATION_PREFIX, clientId),
  );
  return result.success ? result.data : null;
}

export function encryptAuthCode(data: AuthorizationCodePayload): string {
  return encryptPayload(AUTH_CODE_PREFIX, data);
}

export function decryptAuthCode(code: string): AuthorizationCodePayload | null {
  const result = authorizationCodePayloadSchema.safeParse(
    decryptPayload(AUTH_CODE_PREFIX, code),
  );
  return result.success ? result.data : null;
}

export function verifyCodeChallenge(
  codeVerifier: string,
  codeChallenge: string,
): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) return false;
  const actual = crypto
    .createHash("sha256")
    .update(codeVerifier, "ascii")
    .digest();

  let expected: Buffer;
  try {
    expected = Buffer.from(codeChallenge, "base64url");
  } catch {
    return false;
  }

  return (
    expected.length === actual.length &&
    crypto.timingSafeEqual(actual, expected)
  );
}

export function hashAuthorizationCode(code: string): string {
  return crypto.createHash("sha256").update(code, "utf8").digest("hex");
}

export function hasTrustedOAuthOrigin(req: Request): boolean {
  return req.headers.get("origin") === getMcpIssuer();
}

export async function readLimitedOAuthBody(req: Request): Promise<string> {
  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const parsedLength = Number(contentLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > MAX_OAUTH_BODY_BYTES
    ) {
      throw new Error("OAuth request body is too large");
    }
  }

  const body = await req.text();
  if (Buffer.byteLength(body, "utf8") > MAX_OAUTH_BODY_BYTES) {
    throw new Error("OAuth request body is too large");
  }
  return body;
}

export const OAUTH_NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
} as const;
