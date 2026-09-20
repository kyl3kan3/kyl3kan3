export function jevGatewayCredential() {
  return process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim();
}

export function isJevConfigured() {
  return Boolean(jevGatewayCredential());
}
