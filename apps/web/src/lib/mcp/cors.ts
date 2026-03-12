const BASE_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

type CorsOptions = {
  exposeHeaders?: string;
};

export function createCorsHeaders(
  allowedMethods: string,
  options: CorsOptions = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    ...BASE_CORS_HEADERS,
    "Access-Control-Allow-Methods": allowedMethods,
  };

  if (options.exposeHeaders) {
    headers["Access-Control-Expose-Headers"] = options.exposeHeaders;
  }

  return headers;
}

export function createCorsOptionsResponse(headers: Record<string, string>) {
  return new Response(null, { status: 204, headers });
}
