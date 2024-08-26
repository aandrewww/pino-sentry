import stream  from 'stream';
import { AsyncResource } from 'async_hooks';
import split from 'split2';
import Pump from 'pumpify';
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

// Local enum declaration, as @sentry/node deprecated using enums over strings for bundle size
export enum Severity {
  Fatal = "fatal",
  Error = "error",
  Warning = "warning",
  Log = "log",
  Info = "info",
  Debug = "debug",
  // @deprecated: "critical" is not present in sentry 7.x sdk
  // https://github.com/getsentry/sentry-javascript/issues/3067
  Critical = "critical",
}

const SEVERITIES_MAP = {
  10: Severity.Debug,   // pino: trace
  20: Severity.Debug,   // pino: debug
  30: Severity.Info,    // pino: info
  40: Severity.Warning, // pino: warn
  50: Severity.Error,   // pino: error
  60: Severity.Fatal,   // pino: fatal
  // Support for useLevelLabels
  // https://github.com/pinojs/pino/blob/master/docs/api.md#uselevellabels-boolean
  trace: Severity.Debug,
  debug: Severity.Debug,
  info: Severity.Info,
  warning: Severity.Warning,
  error: Severity.Error,
  fatal: Severity.Fatal,
} as const;

// How severe the Severity is
const SeverityIota  = {
  [Severity.Debug]: 1,
  [Severity.Log]: 2,
  [Severity.Info]: 3,
  [Severity.Warning]: 4,
  [Severity.Error]: 5,
  [Severity.Fatal]: 6,
  [Severity.Critical]: 7,
} as const;

export interface PinoSentryOptions {
  /** Minimum level for a log to be reported to Sentry from pino-sentry */
  level?: keyof typeof SeverityIota;
  messageAttributeKey?: string;
  extraAttributeKeys?: string[];
  stackAttributeKey?: string;
  maxValueLength?: number;
  sentryExceptionLevels?: Severity[];
  decorateScope?: (data: Record<string, unknown>, _scope: Sentry.Scope) => void;
}

function get(data: any, path: string) {
  return path.split('.').reduce((acc, part) => acc && acc[part], data);
}

export class PinoSentryTransport {
  // Default minimum log level to `debug`
  minimumLogLevel: ValueOf<typeof SeverityIota> = SeverityIota[Severity.Debug];
  messageAttributeKey = 'msg';
  extraAttributeKeys = ['extra'];
  stackAttributeKey = 'stack';
  maxValueLength = 250;
  sentryExceptionLevels = [Severity.Fatal, Severity.Error];
  decorateScope = (_data: Record<string, unknown>, _scope: Sentry.Scope) => {/**/};

  
  public constructor(options?: PinoSentryOptions & Sentry.NodeOptions)
  public constructor(options?: PinoSentryOptions, initializeSentry: false)
  public constructor(options?: any, initializeSentry?: boolean = true) {
    const validatedOptions = this.validateOptions(options || {});

    if (initializeSentry) {
      Sentry.init(validatedOptions)
    }
  }

  public getLogSeverity(level: keyof typeof SEVERITIES_MAP): Severity {
    return SEVERITIES_MAP[level] || Severity.Info;
  }

  public get sentry() {
    return Sentry;
  }

  public transformer(): stream.Transform {
    return through.obj((chunk: any, _enc: any, cb: any) => {
      this.prepareAndGo(chunk, cb);
    });
  }

  public prepareAndGo(chunkInfo: ChunkInfo, cb: any): void {
    chunkInfo.run((chunk) => {
      this.chunkInfoCallback(chunk, cb);
    });
  }

  private chunkInfoCallback(chunk: any, cb: any) {
    const severity = this.getLogSeverity(chunk.level);

    // Check if we send this Severity to Sentry
    if (!this.shouldLog(severity)) {
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
      const value = get(chunk, key);
      if(value !== undefined) {
        extra[key] = value;
      }
    });
    const message: any & Error = get(chunk, this.messageAttributeKey);
    const stack = get(chunk, this.stackAttributeKey) || '';

    const scope = new Sentry.Scope();
    this.decorateScope(chunk, scope);

    scope.setLevel(severity as any);

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

      Sentry.captureException(error, scope);
      setImmediate(cb);
    } else {
      // Capturing Messages
      Sentry.captureMessage(message, scope);
      setImmediate(cb);
    }
  }

  private validateOptions(options: PinoSentryOptions): PinoSentryOptions {
    const dsn = options.dsn || process.env.SENTRY_DSN;

    if (!dsn) {
      console.log('Warning: [pino-sentry] Sentry DSN must be supplied, otherwise logs will not be reported. Pass via options or `SENTRY_DSN` environment variable.');
    }

    if (options.level) {
      const allowedLevels = Object.keys(SeverityIota);

      if (!allowedLevels.includes(options.level))  {
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

  private isSentryException(level: Severity): boolean {
    return this.sentryExceptionLevels.includes(level);
  }

  private shouldLog(severity: Severity): boolean {
    const logLevel = SeverityIota[severity];
    return logLevel >= this.minimumLogLevel;
  }
}

class ChunkInfo extends AsyncResource {
  constructor(private readonly chunk: any) {
    super("ChunkInfo");
  }

  run<T extends readonly unknown[], R>(callback: (...args: any[]) => R, ...args: T): R {
    try {
      return this.runInAsyncScope(callback, undefined, this.chunk, ...args);
    } finally {
      this.emitDestroy();
    }
  }
}

export function createWriteStream(options?: PinoSentryOptions): stream.Duplex {
  const transport = new PinoSentryTransport(options);
  const sentryTransformer = transport.transformer();

  return new Pump(
    split((line) => {
      try {
        return new ChunkInfo(JSON.parse(line));
      } catch (e) {
        // Returning undefined will not run the sentryTransformer
        return;
      }
    }),
    sentryTransformer
  );
}

// Duplicate to not break API
export const createWriteStreamAsync = createWriteStream;
