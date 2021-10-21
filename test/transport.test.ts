import pino from "pino";

const transport = pino.transport({
  target: 'pino-sentry',
  options: {},
});

pino(transport);
