import type { IncomingMessage } from "node:http";
import { createPublicKey, verify } from "node:crypto";

export function createAuthorization(team: string | undefined, audience: string | undefined) {
  let keys: { kid: string; [key: string]: unknown }[] = [];
  let expires = 0;
  return async function authorized(req: IncomingMessage) {
    if (!team || !audience) return process.env.NODE_ENV !== "production";
    try {
      const token = req.headers["cf-access-jwt-assertion"];
      if (typeof token !== "string") return false;
      const parts = token.split(".");
      if (parts.length !== 3) return false;
      const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
      const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      const now = Date.now() / 1000;
      if (
        header.alg !== "RS256" ||
        claims.iss !== team ||
        !Number.isFinite(claims.exp) ||
        claims.exp <= now ||
        (claims.nbf && claims.nbf > now) ||
        ![claims.aud].flat().includes(audience)
      )
        return false;
      if (expires < Date.now() || !keys.some((k) => k.kid === header.kid)) {
        const response = await fetch(`${team}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) return false;
        keys = (await response.json()).keys;
        expires = Date.now() + 3600000;
      }
      const key = keys.find((k) => k.kid === header.kid);
      return (
        !!key &&
        verify(
          "RSA-SHA256",
          Buffer.from(parts.slice(0, 2).join(".")),
          createPublicKey({ key, format: "jwk" }),
          Buffer.from(parts[2], "base64url"),
        )
      );
    } catch {
      return false;
    }
  };
}
