import { z } from "zod";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PKCE_VALUE = /^[A-Za-z0-9._~-]{43,128}$/;
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export function isAllowedOAuthRedirectUri(value: string): boolean {
  if (value.length > 2048) return false;

  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

const redirectUri = z
  .string()
  .min(1)
  .max(2048)
  .refine(isAllowedOAuthRedirectUri, "Invalid OAuth redirect URI");

export const clientRegistrationRequestSchema = z.object({
  client_name: z.string().trim().min(1).max(100).default("MCP Client"),
  redirect_uris: z
    .array(redirectUri)
    .min(1)
    .max(10)
    .refine((values) => new Set(values).size === values.length, {
      message: "Redirect URIs must be unique",
    }),
  grant_types: z
    .array(z.enum(["authorization_code", "refresh_token"]))
    .min(1)
    .max(2)
    .refine((values) => values.includes("authorization_code"), {
      message: "Authorization code grant is required",
    })
    .refine((values) => new Set(values).size === values.length, {
      message: "Grant types must be unique",
    })
    .default(["authorization_code"]),
  response_types: z.array(z.literal("code")).length(1).default(["code"]),
  token_endpoint_auth_method: z.literal("none").default("none"),
  application_type: z.enum(["native", "web"]).optional(),
});

export const authorizationRequestSchema = z.object({
  clientId: z.string().min(1).max(8192),
  redirectUri,
  resource: z.string().min(1).max(2048),
  codeChallenge: z.string().regex(S256_CHALLENGE),
  codeChallengeMethod: z.literal("S256"),
  responseType: z.literal("code"),
  state: z.string().max(1024).optional(),
  scope: z.literal("open-brain").optional(),
});

export const tokenRequestSchema = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string().min(1).max(8192),
  code_verifier: z.string().regex(PKCE_VALUE),
  redirect_uri: redirectUri,
  client_id: z.string().min(1).max(8192),
  resource: z.string().min(1).max(2048),
});

export const clientRegistrationPayloadSchema = z.object({
  clientName: z.string().min(1).max(100),
  redirectUris: z.array(redirectUri).min(1).max(10),
  issuedAt: z.number().int().nonnegative(),
});

export const authorizationCodePayloadSchema = z.object({
  apiKey: z.string().regex(/^ob_[a-f0-9]{64}$/),
  clientId: z.string().min(1).max(8192),
  redirectUri,
  resource: z.string().min(1).max(2048),
  codeChallenge: z.string().regex(S256_CHALLENGE),
  scope: z.literal("open-brain"),
  exp: z.number().int().positive(),
});

export type ClientRegistrationRequest = z.infer<
  typeof clientRegistrationRequestSchema
>;
export type ClientRegistrationPayload = z.infer<
  typeof clientRegistrationPayloadSchema
>;
export type AuthorizationCodePayload = z.infer<
  typeof authorizationCodePayloadSchema
>;
