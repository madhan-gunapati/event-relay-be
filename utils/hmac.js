import crypto from "crypto";


export function generateHmac(length = 32) {
  return crypto.randomBytes(length).toString("hex");
}


export function generateHmacSignature(secret, payload) {
  const data = typeof payload === "string" ? payload : JSON.stringify(payload);
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}


export function verifyHmacSignature(secret, payload, signature) {
  const expectedSignature = generateHmacSignature(secret, payload);
  return crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature));
}
