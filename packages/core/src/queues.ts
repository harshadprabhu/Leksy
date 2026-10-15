import { Queue, type ConnectionOptions } from "bullmq";

export const QUEUES = {
  process: "bill-process",
  deliver: "bill-deliver",
  pull: "connector-pull",
  alert: "feedback-alert",
  webhook: "webhook-send",
} as const;

export interface ProcessJob { billId: string; event: "bill.created" | "bill.updated" }
export interface DeliverJob { billId: string; channels: ("whatsapp" | "sms" | "email")[] }
export interface PullJob { connectorId: string }
export interface AlertJob { feedbackId: string }
export interface WebhookJob { endpointId: string; event: string; payload: Record<string, unknown> }

export function redisConnection(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password || undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

const defaults = { attempts: 5, backoff: { type: "exponential" as const, delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000 };

export function createQueues(connection: ConnectionOptions) {
  return {
    process: new Queue<ProcessJob>(QUEUES.process, { connection, defaultJobOptions: defaults }),
    deliver: new Queue<DeliverJob>(QUEUES.deliver, { connection, defaultJobOptions: defaults }),
    pull: new Queue<PullJob>(QUEUES.pull, { connection, defaultJobOptions: { ...defaults, attempts: 3 } }),
    alert: new Queue<AlertJob>(QUEUES.alert, { connection, defaultJobOptions: defaults }),
    webhook: new Queue<WebhookJob>(QUEUES.webhook, { connection, defaultJobOptions: { ...defaults, attempts: 8 } }),
  };
}

export type Queues = ReturnType<typeof createQueues>;
