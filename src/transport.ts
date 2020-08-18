import stream  from 'stream';
import split from 'split2';
import pump from 'pump';
import through from 'through2';
import pify from 'pify';
import * as Sentry from '@sentry/node';

type ValueOf<T> = T extends any[] ? T[number] : T[keyof T]

class ExtendedError extends Error {
  public constructor(info: any) {
    super(info.message);

    this.name = "Error";
    this.stack = info.stack || null;
  }
}

function writeToStdout() {
  return through(function(chunk, _enc, cb) {
    this.push(chunk);
    process.stdout.write(chunk);
    cb();
  });
}

const SEVERITIES_MAP = {
  10: Sentry.Severity.Debug,   // pino: trace
  20: Sentry.Severity.Debug,   // pino: debug
  30: Sentry.Severity.Info,    // pino: info
  40: Sentry.Severity.Warning, // pino: warn
  50: Sentry.Severity.Error,   // pino: error
  60: Sentry.Severity.Fatal,   // pino: fatal
  // Support for useLevelLabels
  // https://github.com/pinojs/pino/blob/master/docs/api.md#uselevellabels-boolean
  trace: Sentry.Severity.Debug,
  debug: Sentry.Severity.Debug,
  info: Sentry.Severity.Info,
  warning: Sentry.Severity.Warning,
  error: Sentry.Severity.Error,
  fatal: Sentry.Severity.Fatal,
} as const;

// How severe the Severity is
const SeverityIota  = {
  [Sentry.Severity.Debug]: 1,
  [Sentry.Severity.Log]: 2,
  [Sentry.Severity.Info]: 3,
  [Sentry.Severity.Warning]: 4,
  [Sentry.Severity.Error]: 5,
  [Sentry.Severity.Fatal]: 6,
  [Sentry.Severity.Critical]: 7,
} as const;

interface PinoSentryOptions extends Sentry.NodeOptions {
  /** Minimum level for a log to be reported to Sentry from pino-sentry */
  level?: keyof typeof SeverityIota;
}

export class PinoSentryTransport {
  // Default minimum log level to `debug`
  minimumLogLevel: ValueOf<typeof SeverityIota> = SeverityIota[Sentry.Severity.Debug]
  public constructor(options?: PinoSentryOptions) {
    Sentry.init(this.validateOptions(options || {}));
  }

  public getLogSeverity(level: keyof typeof SEVERITIES_MAP): Sentry.Severity {
    return SEVERITIES_MAP[level] || Sentry.Severity.Info;
  }

  public get sentry() {
    return Sentry;
  }

  public parse(line: any) {
    const chunk = JSON.parse(line);
    const cb = () => {
    };

    this.prepareAndGo(chunk, cb);
  }

  public transformer(): stream.Transform {
    return through.obj((chunk: any, _enc: any, cb: any) => {
      this.prepareAndGo(chunk, cb);
    });
  }

  public prepareAndGo(chunk: any, cb: any): void {
    const severity = this.getLogSeverity(chunk.level);
    // Check if we send this Severity to Sentry
    if (this.shouldLog(severity) === false) {
      setImmediate(cb);
      return;
    };

    const tags = chunk.tags || {};

    if (chunk.reqId) {
      tags.uuid = chunk.reqId;
    }

    if (chunk.responseTime) {
      tags.responseTime = chunk.responseTime;
    }

    if (chunk.hostname) {
      tags.hostname = chunk.hostname;
    }

    // const user = chunk.user || {};

    const message = chunk.msg;
    const stack = chunk.stack || '';

    Sentry.configureScope(scope => {
      if (this.isObject(tags)) {
        Object.keys(tags).forEach(tag => scope.setExtra(tag, tags[tag]));
      }
    });

    // Capturing Errors / Exceptions
    if (this.isSentryException(severity)) {
      const error = message instanceof Error ? message : new ExtendedError({ message, stack });

      setImmediate(() => {
        Sentry.captureException(error);
        cb();
      });
    } else {
      // Capturing Messages
      setImmediate(() => {
        Sentry.captureMessage(message, severity);
        cb();
      });
    }
  }

  private validateOptions(options: PinoSentryOptions): PinoSentryOptions {
    const dsn = options.dsn || process.env.SENTRY_DSN;
    if (!dsn) {
      throw Error('[pino-sentry] Sentry DSN must be supplied. Pass via options or `SENTRY_DSN` environment variable');
    }
    if (options.level) {
      const allowedLevels = Object.keys(SeverityIota);
      if (allowedLevels.includes(options.level) === false)  {
        throw new Error(`[pino-sentry] Option \`level\` must be one of: ${allowedLevels.join(', ')}. Received: ${options.level}`);
      }
      // Set minimum log level
      this.minimumLogLevel = SeverityIota[options.level];
    }

    return {
      dsn,
      // npm_package_name will be available if ran with
      // from a "script" field in package.json.
      serverName: process.env.npm_package_name || 'pino-sentry',
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
      debug: !!process.env.SENTRY_DEBUG || false,
      sampleRate: 1.0,
      maxBreadcrumbs: 100,
      ...options,
    };
  }

  private isObject(obj: any): boolean {
    const type = typeof obj;
    return type === 'function' || type === 'object' && !!obj;
  }

  private isSentryException(level: Sentry.Severity): boolean {
    return level === Sentry.Severity.Fatal || level === Sentry.Severity.Error;
  }

  private shouldLog(severity: Sentry.Severity): boolean {
    const logLevel = SeverityIota[severity];
    return logLevel >= this.minimumLogLevel;
  }
};

export function createWriteStreamAsync(options?: PinoSentryOptions): PromiseLike<stream.Transform> {
  const transport = new PinoSentryTransport(options);
  const sentryTransformer = transport.transformer();

  const pumpAsync = pify(pump);
  return pumpAsync(
    process.stdin.pipe(writeToStdout()),
    split((line) => {
      try {
        return JSON.parse(line);
      } catch (e) {
        throw Error('logs should be in json format');
      }
    }),
    sentryTransformer
  );
};


export function createWriteStream(options?: PinoSentryOptions): stream.Transform & { transport: PinoSentryTransport } {
  const transport = new PinoSentryTransport(options);
  const sentryParse = transport.parse.bind(transport);

  return Object.assign(split(sentryParse), { transport });
};
