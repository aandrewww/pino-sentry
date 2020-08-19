const pinoLogger = require('pino');
const { createWriteStream } = require('../dist/index');

function main() {
  const SENTRY_DSN = "https://123@123.ingest.sentry.io/123";

  const options = {
    level: "info"
  };

  const stream = createWriteStream({ dsn: SENTRY_DSN });

  const logger = pinoLogger(options, stream);

  logger.info('testtt info log');
  logger.error('testtt log');
}

main();
