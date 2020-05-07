const pinoLogger = require('../node_modules/pino');
const { createWriteStream } = require('../dist/index');

async function main () {
  const SENTRY_DSN = "https://0d5b2413b1a04f538b11999a61d37d2b@sentry.scorum.com/1";

  const options = {
    level: "info"
  };

  const stream = createWriteStream({ dsn: SENTRY_DSN });

  const logger = pinoLogger(options, stream);

  logger.info('testtt info log');
  logger.error('testtt log');
}

main();
