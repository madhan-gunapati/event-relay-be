import { Queue, Worker, QueueEvents } from "bullmq";
import axios from "axios";
import crypto from "crypto";
import Redis from "ioredis";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const redisConnection = new Redis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: null, 
});

// Create Queue
export const eventDeliveryQueue = new Queue("event-delivery-queue", {
  connection: redisConnection,
});

// Queue events listener (for logging)
const queueEvents = new QueueEvents("event-delivery-queue", {
  connection: redisConnection,
});
queueEvents.on("completed", ({ jobId }) => {
  console.log(` Job ${jobId} completed`);
});
queueEvents.on("failed", ({ jobId, failedReason }) => {
  console.log(` Job ${jobId} failed: ${failedReason}`);
});

// Helper function to enqueue a delivery
export async function enqueueEventDelivery(eventId, subscriptionId, isRetry = false) {
  await eventDeliveryQueue.add(
    "deliver-event",
    { eventId, subscriptionId, isRetry },
    {
      attempts: 5, // Retry up to 5 times
      backoff: { type: "exponential", delay: 5000 }, // Exponential backoff (5s, 10s, 20s...)
      removeOnComplete: true,
      removeOnFail: false,
    }
  );
}

// Function to generate HMAC signature
function generateHmacSignature(secret, payload) {
  return crypto.createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex");
}

// Worker that processes the jobs
export const eventWorker = new Worker(
  "event-delivery-queue",
  async (job) => {
    const { eventId, subscriptionId, isRetry } = job.data;

    // Fetch event + subscription details
    const [event, subscription] = await Promise.all([
      prisma.event.findUnique({ where: { id: eventId } }),
      prisma.subscription.findUnique({ where: { id: subscriptionId } }),
    ]);

    if (!event || !subscription) {
      throw new Error("Missing event or subscription data");
    }

    // Generate HMAC signature
    const signature = generateHmacSignature(subscription.secret, event.payload);
    const headers = {
      "Content-Type": "application/json",
      "X-AlgoHire-Signature": signature,
      "X-AlgoHire-Event": event.eventType,
      "X-AlgoHire-Timestamp": new Date().toISOString(),
    };

    try {
      // Send webhook
      const response = await axios.post(subscription.targetUrl, event.payload, {
        headers,
        timeout: 5000,
      });

      // Store delivery log
      await prisma.delivery.create({
        data: {
          eventId,
          subscriptionId,
          status: "SUCCESS",
          responseCode: response.status,
          responseBody: JSON.stringify(response.data).slice(0, 1000), // limit for size
          attempts: job.attemptsMade + 1,
        },
      });

      // Update event status if all deliveries succeed
      if (!isRetry) {
        await prisma.event.update({
          where: { id: eventId },
          data: { status: "DELIVERED" },
        });
      }

      console.log(`Delivered event ${eventId} to ${subscription.targetUrl}`);
    } catch (err) {
      console.error(` Delivery failed for ${eventId} to ${subscription.targetUrl}: ${err.message}`);

      // Store failed delivery attempt
      await prisma.delivery.create({
        data: {
          eventId,
          subscriptionId,
          status: "FAILED",
          errorMessage: err.message,
          attempts: job.attemptsMade + 1,
        },
      });

      // Throw error so BullMQ will retry automatically
      throw err;
    }
  },
  { connection: redisConnection }
);

// Graceful shutdown handling
process.on("SIGINT", async () => {
  console.log(" Shutting down worker...");
  await eventWorker.close();
  await redisConnection.quit();
  process.exit(0);
});
