import crypto from "crypto";


// Used for internal  modules posting events
export function authInternal(req, res, next) {
  const token = req.headers["x-internal-token"];
  
  if (!token || token !== process.env.INTERNAL_API_TOKEN) {
    
    return res.status(401).json({ error: "Unauthorized - Invalid internal token" });
  }
  next();
}


// Protects dashboard / admin APIs
export function authAdmin(req, res, next) {
  const adminToken = req.headers["x-admin-token"];
  if (!adminToken || adminToken !== process.env.ADMIN_API_TOKEN) {
    return res.status(401).json({ error: "Unauthorized - Admin access required" });
  }
  next();
}


// Ensures event payload is valid before enqueueing
export function validateEvent(req, res, next) {
  const { eventType, payload } = req.body;
  if (!eventType || typeof eventType !== "string") {
    return res.status(400).json({ error: "Invalid or missing 'eventType'" });
  }
  if (!payload || typeof payload !== "object") {
    return res.status(400).json({ error: "Invalid or missing 'payload'" });
  }
  next();
}


// Ensures webhook registration payload is valid
export function validateWebhook(req, res, next) {
  const { clientName, eventType, targetUrl } = req.body;
  if (!clientName || typeof clientName !== "string") {
    return res.status(400).json({ error: "Invalid or missing 'clientName'" });
  }
  if (!eventType || typeof eventType !== "string") {
    return res.status(400).json({ error: "Invalid or missing 'eventType'" });
  }
  if (!targetUrl || !/^https?:\/\/.+$/.test(targetUrl)) {
    return res.status(400).json({ error: "Invalid or missing 'targetUrl'" });
  }
  next();
}


// For verifying incoming webhooks (if needed)
export function verifyHmac(req, secret) {
  const signature = req.headers["x-algohire-signature"];
  const payload = JSON.stringify(req.body);

  const hmac = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return signature === hmac;
}
