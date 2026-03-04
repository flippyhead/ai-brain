import crypto from "crypto";

// Derive encryption key from CONVEX_DEPLOYMENT (server-side only, stable across instances)
function getEncryptionKey(): Buffer {
  const secret = process.env.CONVEX_DEPLOYMENT || "mcp-auth-fallback";
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptAuthCode(data: {
  apiKey: string;
  codeChallenge: string;
  redirectUri: string;
  exp: number;
}): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(data), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function decryptAuthCode(code: string): {
  apiKey: string;
  codeChallenge: string;
  redirectUri: string;
  exp: number;
} | null {
  try {
    const key = getEncryptionKey();
    const buf = Buffer.from(code, "base64url");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    return null;
  }
}

export function verifyCodeChallenge(
  codeVerifier: string,
  codeChallenge: string,
): boolean {
  const hash = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return hash === codeChallenge;
}
