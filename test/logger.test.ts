import pinoLogger from "pino";
import { createWriteStream } from "../src";

test('Test logger creation', () => {
  const SENTRY_DSN = "https://123@123.ingest.sentry.io/123";

  const options = {
    level: "info"
  };

  const stream = createWriteStream({ dsn: SENTRY_DSN });

  const logger = pinoLogger(options, stream);

  logger.info('testtt info log');
  logger.error('testtt log');
});
