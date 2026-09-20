import { getContext } from "@vercel/oidc";

export function jevGatewayCredential() {
  // Resolve for every request; never cache an expiring production OIDC token.
  return process.env.AI_GATEWAY_API_KEY?.trim() || getContext().headers?.["x-vercel-oidc-token"]?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim();
}

export function isJevConfigured() {
  return Boolean(jevGatewayCredential());
}
