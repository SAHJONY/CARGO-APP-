"use strict";

const crypto = require("node:crypto");

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function createSession(actorId, secret, ttlSeconds = 3600) {
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  const payload = encode({ sub: actorId, exp: Math.floor(Date.now() / 1000) + ttlSeconds });
  return `${payload}.${sign(payload, secret)}`;
}

function verifySession(token, secret) {
  if (!token || !secret || secret.length < 32) throw new Error("Authentication required");
  const [payload, signature] = token.split(".");
  if (!payload || !signature) throw new Error("Invalid session");
  const expected = sign(payload, secret);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error("Invalid session");
  }
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!claims.sub || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error("Session expired");
  return claims;
}

function actorFromRequest(req, secret) {
  const value = req.headers.authorization || "";
  if (!value.startsWith("Bearer ")) throw new Error("Authentication required");
  return verifySession(value.slice(7), secret).sub;
}

module.exports = { createSession, verifySession, actorFromRequest };
