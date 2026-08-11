import {
  assertOAuthEncryptionConfigured,
  encryptClientRegistration,
  OAUTH_NO_STORE_HEADERS,
  readLimitedOAuthBody,
} from "@/lib/mcp/oauth";
import { clientRegistrationRequestSchema } from "@/lib/mcp/oauth-validation";

function registrationError(description: string, status = 400) {
  return Response.json(
    { error: "invalid_client_metadata", error_description: description },
    { status, headers: OAUTH_NO_STORE_HEADERS },
  );
}

export async function POST(req: Request) {
  if (
    !req.headers.get("content-type")?.toLowerCase().includes("application/json")
  ) {
    return registrationError("Content-Type must be application/json", 415);
  }

  let input: unknown;
  try {
    assertOAuthEncryptionConfigured();
    input = JSON.parse(await readLimitedOAuthBody(req)) as unknown;
  } catch {
    return registrationError("Invalid registration request");
  }

  const parsed = clientRegistrationRequestSchema.safeParse(input);
  if (!parsed.success) {
    return registrationError("Invalid client metadata");
  }

  const clientId = encryptClientRegistration({
    clientName: parsed.data.client_name,
    redirectUris: parsed.data.redirect_uris,
    issuedAt: Date.now(),
  });

  return Response.json(
    {
      client_id: clientId,
      client_name: parsed.data.client_name,
      redirect_uris: parsed.data.redirect_uris,
      // MCP clients commonly advertise refresh-token capability even when the
      // authorization server issues a non-expiring bearer credential. Return
      // only the grant this server actually supports.
      grant_types: ["authorization_code"],
      response_types: parsed.data.response_types,
      token_endpoint_auth_method: parsed.data.token_endpoint_auth_method,
      application_type: parsed.data.application_type,
      client_id_issued_at: Math.floor(Date.now() / 1000),
    },
    { status: 201, headers: OAUTH_NO_STORE_HEADERS },
  );
}
