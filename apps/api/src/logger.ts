import pino from "pino";
import type { Config } from "./config.js";

// N30: log tidak boleh memuat password, token, cookie, atau data pribadi
export const REDACT_PATHS = [
  "password", "token", "email", "phone", "address", "recipient",
  "*.password", "*.token", "*.email", "*.phone", "*.address", "*.recipient",
  "req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]',
];

export function createLogger(config: Pick<Config, "logLevel">, destination?: pino.DestinationStream) {
  return pino({ level: config.logLevel, redact: { paths: REDACT_PATHS, censor: "[disamarkan]" } }, destination);
}
