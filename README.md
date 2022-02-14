# pino-sentry

[![CircleCI](https://circleci.com/gh/aandrewww/pino-sentry.svg?style=svg)](https://circleci.com/gh/aandrewww/pino-sentry)
[![node](https://img.shields.io/badge/node-6.4.0+-brightgreen.svg)][node-url]
[![license](https://img.shields.io/github/license/aandrewww/pino-sentry.svg)][license-url]

Load [pino](https://github.com/pinojs/pino) logs into [Sentry](https://sentry.io/)

## Index

- [Install](#install)
- [Usage](#usage)
  - [CLI](#cli)
  - [API](#api)
- [Options](#options-options)
  - [Transport options](#transport-options)
  - [Log Level Mapping](#log-level-mapping)
- [License](#license)

## Install

```bash
npm install pino-sentry -g
```

## Usage

### CLI

```bash
node ./app.js | pino-sentry --dsn=https://******@sentry.io/12345
```

### API

```js
const { createWriteStream, Sentry } = require("pino-sentry");
// ...
const opts = {
  /* ... */
};
const stream = createWriteStream({ dsn: process.env.SENTRY_DSN });
const logger = pino(opts, stream);

// add tags
logger.info({ tags: { foo: "bar" }, msg: "Error" });

// add extra
logger.info({ extra: { foo: "bar" }, msg: "Error" });

// add breadcrumbs
// https://docs.sentry.io/platforms/node/enriching-events/breadcrumbs/
logger.info({
  msg: "Error",
  breadcrumbs: [
    {
      category: "auth",
      message: "Authenticated user " + user.email,
      level: "info",
    },
  ],
});

// the sentry instance is exposed and can be used to manipulate the same sentry than pino-sentry
Sentry.addBreadcrumb({
  category: "custom-logger",
  message: "Hey there!",
  level: "debug",
  type: "debug",
  data: { some: "data" },
});
```

## Options (`options`)

### Override Message Attributes

In case the generated message does not follow the standard convention, the main attribute keys can be mapped to different values, when the stream gets created. Following attribute keys can be overridden:

- `msg` - the field used to get the message, it can be dot notted (eg 'data.msg')
- `extra`
- `stack` - the field used to get the stack, it can be dot notted (eg 'err.stack')
- `maxValueLength` - option to adjust max string length for values, default is 250
- `decorateScope` - option to decorate, manipulate the sentry scope just before the capture
- `sentryExceptionLevels` - option that represent the levels that will be handled as exceptions. Default : `error` and `fatal`

```js
const { createWriteStream, Sentry } = require("pino-sentry");
// ...
const opts = {
  /* ... */
};
const stream = createWriteStream({
  dsn: process.env.SENTRY_DSN,
  messageAttributeKey: "message",
  stackAttributeKey: "trace",
  extraAttributeKeys: ["req", "context"],
  maxValueLength: 250,
  sentryExceptionLevels: [
    Sentry.Severity.Warning,
    Sentry.Severity.Error,
    Sentry.Severity.Fatal,
  ],
  decorateScope: (data, scope) => {
    scope.setUser("userId", { id: data.userId });
  },
});
const logger = pino(opts, stream);
```

### Transport options

- `--dsn` (`-d`): your Sentry DSN or Data Source Name (defaults to `process.env.SENTRY_DSN`)
- `--environment` (`-e`): (defaults to `process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production'`)
- `--serverName` (`-n`): transport name (defaults to `pino-sentry`)
- `--debug` (`-dm`): turns debug mode on or off (default to `process.env.SENTRY_DEBUG || false`)
- `--sampleRate` (`-sr`): sample rate as a percentage of events to be sent in the range of 0.0 to 1.0 (default to `1.0`)
- `--maxBreadcrumbs` (`-mx`): total amount of breadcrumbs that should be captured (default to `100`)
- `--level` (`-l`): minimum level for a log to be reported to Sentry (default to `debug`)

### Log Level Mapping

Pino logging levels are mapped by default to Sentry's acceptable levels.

```js
{
  trace: 'debug',
  debug: 'debug',
  info: 'info',
  warn: 'warning',
  error: 'error',
  fatal: 'fatal'
}
```

## License

[MIT License][license-url]

[license-url]: LICENSE
[node-url]: https://nodejs.org
