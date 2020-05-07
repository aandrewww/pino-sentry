import stream  from 'stream';
import split from 'split2';
import pump from 'pump';
import through from 'through2';
import pify from 'pify';
import * as Sentry from '@sentry/node';

class ExtendedError extends Error {
  public constructor(info: any) {
    super(info.message);

    this.name = "Error";
    this.stack = info.stack || null;
  }
}

function defaults<T>(target: Partial<T>, source: Partial<T>): Partial<T> {
  const ret: Partial<T> = { ...target };
  for (const key of (Object.keys(source) as (keyof T)[])) {
    if (target[key] === undefined) {
      ret[key] = source[key];
    }
  }
  return ret;
}

export class PinoSentryTransport {
  private SEVERITIES_MAP = {
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
  };

  public constructor(options?: Sentry.NodeOptions) {
    Sentry.init(this.withDefaults(options || {}));
  }

  public getLogSeverity(level: number): Sentry.Severity {
    return (this.SEVERITIES_MAP as any)[level] || Sentry.Severity.Info;
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
    if (this.shouldLogException(severity)) {
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

  private withDefaults(options: Sentry.NodeOptions): Sentry.NodeOptions {
    if (!options) {
      options = {};
    }
    return defaults(options, {
      dsn: process.env.SENTRY_DSN || '',
      // npm_package_name will be available if ran with
      // from a "script" field in package.json.
      serverName: process.env.npm_package_name || 'pino-sentry',
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
      debug: !!process.env.SENTRY_DEBUG || false,
      sampleRate: 1.0,
      maxBreadcrumbs: 100,
    });
  }

  private isObject(obj: any): boolean {
    const type = typeof obj;
    return type === 'function' || type === 'object' && !!obj;
  }

  private shouldLogException(level: Sentry.Severity): boolean {
    return level === Sentry.Severity.Fatal || level === Sentry.Severity.Error;
  }
};

export function createWriteStreamAsync(options: Sentry.NodeOptions = {}): PromiseLike<stream.Transform> {
  if (!options.dsn && !process.env.SENTRY_DSN) {
    throw Error('Sentry DSN missing');
  }

  const transport = new PinoSentryTransport(options);
  const sentryTransformer = transport.transformer();

  const pumpAsync = pify(pump);
  return pumpAsync(process.stdin, split((line) => {
    try {
      return JSON.parse(line);
    } catch (e) {
      throw Error('logs should be in json format');
    }
  }), sentryTransformer);
};


export function createWriteStream(options: Sentry.NodeOptions = {}): stream.Transform & { transport: PinoSentryTransport } {
  if (!options.dsn && !process.env.SENTRY_DSN) {
    throw Error('Sentry DSN missing');
  }

  const transport = new PinoSentryTransport(options);
  const sentryParse = transport.parse.bind(transport);

  return Object.assign(split(sentryParse), { transport });
};
