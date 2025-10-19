import express from "express";
import { PrismaClient } from "@prisma/client";
import { validateEvent, authInternal, authAdmin, validateWebhook } from "./middlewares/index.js";
import { enqueueEventDelivery } from "./workers/eventQueue.js";
import { generateHmac } from "./utils/hmac.js";

const app = express();
app.use(express.json());

 const prisma = new PrismaClient();

//sample 
app.get('/', (req, res)=>{
    res.send('Working fine')
})

// Receive event from internal  modules
app.post("/api/events", authInternal, validateEvent, async (req, res) => {
  try {
    const { eventType, payload } = req.body;

    // Store event in DB
    const event = await prisma.event.create({
      data: {
        eventType,
        payload,
        status: "PENDING",
      },
    });

    // Fetch active subscribers for this event type
    const subscribers = await prisma.subscription.findMany({
      where: { eventType, isActive: true },
    });

    // Queue event for delivery
    for (const sub of subscribers) {
      await enqueueEventDelivery(event.id, sub.id);
    }

    res.status(201).json({ success: true, eventId: event.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Event processing failed" });
  }
});

// Get specific event details
app.get("/api/events/:id", authAdmin, async (req, res) => {
  const event = await prisma.event.findUnique({ where: { id: req.params.id } });
  if (!event) return res.status(404).json({ error: "No Events found" });
  res.json(event);
});



// Register new webhook
app.post("/api/webhooks/register", validateWebhook, async (req, res) => {
  const { clientName, eventType, targetUrl } = req.body;

  const webhook = await prisma.subscription.create({
    data: {
      clientName,
      eventType,
      targetUrl,
      secret: generateHmac(),
      isActive: true,
    },
  });

  res.status(201).json({ message: "Webhook registered", webhook });
});

// List all webhooks (admin)
app.get("/api/webhooks", authAdmin, async (req, res) => {
  const hooks = await prisma.subscription.findMany();
  res.json(hooks);
});

// Enable/disable webhook
app.patch("/api/webhooks/:id", authAdmin, async (req, res) => {
  const { isActive } = req.body;
  const updated = await prisma.subscription.update({
    where: { id: req.params.id },
    data: { isActive },
  });
  res.json(updated);
});

// Delete webhook
app.delete("/api/webhooks/:id", authAdmin, async (req, res) => {
  await prisma.subscription.delete({ where: { id: req.params.id } });
  res.json({ message: "Webhook deleted" });
});



// Get all delivery logs
app.get("/api/deliveries", authAdmin, async (req, res) => {
  const logs = await prisma.delivery.findMany({ orderBy: { createdAt: "desc" } });
  res.json(logs);
});

// Retry a failed delivery
app.post("/api/deliveries/:id/retry", authAdmin, async (req, res) => {
  const delivery = await prisma.delivery.findUnique({ where: { id: req.params.id } });
  if (!delivery) return res.status(404).json({ error: "Delivery not found" });

  await enqueueEventDelivery(delivery.eventId, delivery.subscriptionId, true);
  res.json({ message: "Retry queued" });
});



// Basic system stats
app.get("/api/admin/stats", authAdmin, async (req, res) => {
  const [eventCount, deliveryCount] = await Promise.all([
    prisma.event.count(),
    prisma.delivery.count(),
  ]);
  res.json({ totalEvents: eventCount, totalDeliveries: deliveryCount });
});

// Health check
app.get("/api/admin/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    // a simple query to just check whether the db is working and also BE layer is working fine!!!
    res.json({ status: "OK" });
  } catch (err) {
    res.status(500).json({ status: "DB ERROR" });
  }
});



const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Webhook Relay API running on port ${PORT}`);
});
