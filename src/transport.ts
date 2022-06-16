import stream  from 'stream';
import split from 'split2';
import pump from 'pumpify';
import through from 'through2';
import * as Sentry from '@sentry/node';
import { Breadcrumb } from '@sentry/types';

type ValueOf<T> = T extends any[] ? T[number] : T[keyof T]

export const SentryInstance = Sentry;
class ExtendedError extends Error {
  public constructor(info: any) {
    super(info.message);

    this.name = "Error";
    this.stack = info.stack || null;
  }
}

const SEVERITIES_MAP = {
  10: 'debug',   // pino: trace
  20: 'debug',   // pino: debug
  30: 'info',    // pino: info
  40: 'warning', // pino: warn
  50: 'error',   // pino: error
  60: 'fatal',   // pino: fatal
  // Support for useLevelLabels
  // https://github.com/pinojs/pino/blob/master/docs/api.md#uselevellabels-boolean
  trace: 'debug',
  debug: 'debug',
  info: 'info',
  warning: 'warning',
  error: 'error',
  fatal: 'fatal',
} as const;

// How severe the Severity is
const SeverityIota: {[x: string]: number}  = {
  ['debug']: 1,
  ['log']: 2,
  ['info']: 3,
  ['warning']: 4,
  ['error']: 5,
  ['fatal']: 6,
  ['critical']: 7,
};

interface PinoSentryOptions extends Sentry.NodeOptions {
  /** Minimum level for a log to be reported to Sentry from pino-sentry */
  level?: string;
  messageAttributeKey?: string;
  extraAttributeKeys?: string[];
  stackAttributeKey?: string;
  maxValueLength?: number;
  sentryExceptionLevels?: Sentry.Severity[];
  decorateScope?: (data: Record<string, unknown>, _scope: Sentry.Scope) => void;
}

function get(data: any, path: string) {
  return path.split('.').reduce((acc, part) => acc && acc[part], data);
}

export class PinoSentryTransport {
  // Default minimum log level to `debug`
  minimumLogLevel: ValueOf<typeof SeverityIota> = SeverityIota['debug']
  messageAttributeKey = 'msg';
  extraAttributeKeys = ['extra'];
  stackAttributeKey = 'stack';
  maxValueLength = 250;
  sentryExceptionLevels = ['fatal','error'];
  decorateScope = (_data: Record<string, unknown>, _scope: Sentry.Scope) => {/**/};

  public constructor(options?: PinoSentryOptions) {
    Sentry.init(this.validateOptions(options || {}));
  }

  public getLogSeverity(level: keyof typeof SEVERITIES_MAP): string {
    return SEVERITIES_MAP[level] || 'info';
  }

  public get sentry() {
    return Sentry;
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
    }

    const tags = chunk.tags || {};
    const breadcrumbs: Breadcrumb[] = chunk.breadcrumbs || {};

    if (chunk.reqId) {
      tags.uuid = chunk.reqId;
    }

    if (chunk.responseTime) {
      tags.responseTime = chunk.responseTime;
    }

    if (chunk.hostname) {
      tags.hostname = chunk.hostname;
    }

    const extra: any = {};
    this.extraAttributeKeys.forEach((key: string) => {
      if(chunk[key] !== undefined) {
        extra[key] = chunk[key];
      }
    });
    const message = get(chunk, this.messageAttributeKey);
    const stack = get(chunk, this.stackAttributeKey) || '';

    const scope = new Sentry.Scope();
    this.decorateScope(chunk, scope);

    scope.setLevel(severity as Sentry.SeverityLevel);

    if (this.isObject(tags)) {
      Object.keys(tags).forEach(tag => scope.setTag(tag, tags[tag]));
    }

    if (this.isObject(extra)) {
      Object.keys(extra).forEach(ext => scope.setExtra(ext, extra[ext]));
    }

    if (this.isObject(breadcrumbs)) {
      Object.values(breadcrumbs).forEach(breadcrumb => scope.addBreadcrumb(breadcrumb));
    }

    // Capturing Errors / Exceptions
    if (this.isSentryException(severity)) {
      const error = message instanceof Error ? message : new ExtendedError({ message, stack });

      setImmediate(() => {
        Sentry.captureException(error, scope);
        cb();
      });
    } else {
      // Capturing Messages
      setImmediate(() => {
        Sentry.captureMessage(message, scope);
        cb();
      });
    }
  }

  private validateOptions(options: PinoSentryOptions): PinoSentryOptions {
    const dsn = options.dsn || process.env.SENTRY_DSN;

    if (!dsn) {
      console.log('Warning: [pino-sentry] Sentry DSN must be supplied, otherwise logs will not be reported. Pass via options or `SENTRY_DSN` environment variable.');
    }

    if (options.level) {
      const allowedLevels = Object.keys(SeverityIota);

      if (allowedLevels.includes(options.level) === false)  {
        throw new Error(`[pino-sentry] Option \`level\` must be one of: ${allowedLevels.join(', ')}. Received: ${options.level}`);
      }

      // Set minimum log level
      this.minimumLogLevel = SeverityIota[options.level];
    }

    this.stackAttributeKey = options.stackAttributeKey ?? this.stackAttributeKey;
    this.extraAttributeKeys = options.extraAttributeKeys ?? this.extraAttributeKeys;
    this.messageAttributeKey = options.messageAttributeKey ?? this.messageAttributeKey;
    this.maxValueLength = options.maxValueLength ?? this.maxValueLength;
    this.sentryExceptionLevels = options.sentryExceptionLevels ?? this.sentryExceptionLevels;
    this.decorateScope = options.decorateScope ?? this.decorateScope;

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

  private isSentryException(level: string): boolean {
    return this.sentryExceptionLevels.includes(level);
  }

  private shouldLog(severity: string): boolean {
    const logLevel = SeverityIota[severity];
    return logLevel >= this.minimumLogLevel;
  }
};

export function createWriteStream(options?: PinoSentryOptions): stream.Duplex {
  const transport = new PinoSentryTransport(options);
  const sentryTransformer = transport.transformer();

  return new pump(
    split((line) => {
      try {
        return JSON.parse(line);
      } catch (e) {
        // Returning undefined will not run the sentryTransformer
        return;
      }
    }),
    sentryTransformer
  );
};

// Duplicate to not break API
export const createWriteStreamAsync = createWriteStream;
