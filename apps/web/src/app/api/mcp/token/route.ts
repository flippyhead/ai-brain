import { decryptAuthCode, verifyCodeChallenge } from "@/lib/mcp/oauth";

export async function POST(req: Request) {
  // Parse form-urlencoded or JSON body
  let params: Record<string, string> = {};
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    const searchParams = new URLSearchParams(text);
    searchParams.forEach((v, k) => (params[k] = v));
  } else if (contentType.includes("application/json")) {
    params = await req.json();
  } else {
    const formData = await req.formData();
    formData.forEach((v, k) => (params[k] = v.toString()));
  }

  const { grant_type, code, code_verifier, redirect_uri } = params;

  if (grant_type !== "authorization_code" || !code || !code_verifier) {
    return Response.json(
      { error: "invalid_request", error_description: "Missing required parameters" },
      { status: 400 },
    );
  }

  const data = decryptAuthCode(code);
  if (!data) {
    return Response.json(
      { error: "invalid_grant", error_description: "Invalid authorization code" },
      { status: 400 },
    );
  }

  if (Date.now() > data.exp) {
    return Response.json(
      { error: "invalid_grant", error_description: "Authorization code expired" },
      { status: 400 },
    );
  }

  if (redirect_uri && redirect_uri !== data.redirectUri) {
    return Response.json(
      { error: "invalid_grant", error_description: "Redirect URI mismatch" },
      { status: 400 },
    );
  }

  if (!verifyCodeChallenge(code_verifier, data.codeChallenge)) {
    return Response.json(
      { error: "invalid_grant", error_description: "Invalid code verifier" },
      { status: 400 },
    );
  }

  return Response.json(
    {
      access_token: data.apiKey,
      token_type: "Bearer",
      expires_in: 31536000, // 1 year in seconds; API keys don't actually expire
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
