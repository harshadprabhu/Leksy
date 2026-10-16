import type { ChannelEnv } from "@leksy/core";
import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().default("postgres://leksy:leksy@localhost:5432/leksy"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  /** Public base URL for bill links, e.g. https://lks.y or https://bills.leksy.in */
  PUBLIC_BASE_URL: z.string().default("http://localhost:4000"),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  /**
   * Proxies whose X-Forwarded-For is believed (client IPs drive rate limits).
   * Default: proxies on loopback and private networks only, so a client on the
   * internet cannot claim another IP.
   */
  TRUST_PROXY: z.string().default("loopback,linklocal,uniquelocal"),
  JWT_SECRET: z.string().min(32).default("dev-only-secret-change-me-dev-only-secret"),
  COOKIE_SECRET: z.string().min(32).default("dev-only-cookie-secret-change-me-0000000"),
  CHROMIUM_PATH: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().default("leksy-dev-verify"),
  /** Allow connectors and webhooks to call private/http URLs (dev only). */
  ALLOW_PRIVATE_URLS: z.stringbool().default(false),
  /** Log messages instead of sending them (default on outside production). */
  CHANNELS_DRY_RUN: z.stringbool().optional(),
  WHATSAPP_API_VERSION: z.string().default("v21.0"),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  SMS_HTTP_URL: z.string().optional(),
  SMS_HTTP_TOKEN: z.string().optional(),
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default("Leksy <bills@leksy.in>"),
});

export type Config = z.infer<typeof Env>;

export function channelEnv(cfg: Config, log: (msg: string, data?: unknown) => void): ChannelEnv {
  return {
    whatsappApiVersion: cfg.WHATSAPP_API_VERSION,
    whatsappPhoneNumberId: cfg.WHATSAPP_PHONE_NUMBER_ID,
    whatsappAccessToken: cfg.WHATSAPP_ACCESS_TOKEN,
    smsHttpUrl: cfg.SMS_HTTP_URL,
    smsHttpToken: cfg.SMS_HTTP_TOKEN,
    smtpUrl: cfg.SMTP_URL,
    emailFrom: cfg.EMAIL_FROM,
    dryRun: cfg.CHANNELS_DRY_RUN ?? cfg.NODE_ENV !== "production",
    log,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cfg = Env.parse(env);
  if (cfg.NODE_ENV === "production" && (cfg.JWT_SECRET.startsWith("dev-only") || cfg.COOKIE_SECRET.startsWith("dev-only"))) {
    throw new Error("Set JWT_SECRET and COOKIE_SECRET in production");
  }
  return cfg;
}
