import pino from "pino";

const transport = pino.transport({
  target: '/absolute/path/to/my-transport.mjs'
});

pino(transport);
