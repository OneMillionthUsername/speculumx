/**
 * Application logger singleton.
 *
 * Writes logs into per-purpose files under `logs/` and also prints to
 * the console. Provides `error`, `warn`, `info`, `debug`, `access` and
 * `auth` helpers and performs daily rotation of files.
 */

import { createWriteStream, existsSync, mkdirSync, accessSync, constants } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOG_DIR = process.env.LOG_DIR || join(__dirname, '..', 'logs');
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function parseLogModes(modes) {
  if (!modes || typeof modes !== 'string') return null;
  const allowedModes = new Set(['error', 'application', 'debug', 'auth', 'access']);
  const parsed = new Set(
    modes
      .split(',')
      .map(mode => mode.trim().toLowerCase())
      .filter(mode => allowedModes.has(mode)),
  );
  return parsed.size > 0 ? parsed : null;
}

function ensureWritableLogDir(dirPath) {
  try {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
    accessSync(dirPath, constants.W_OK);
    return true;
  } catch (error) {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 'n/a';
    const gid = typeof process.getgid === 'function' ? process.getgid() : 'n/a';
    console.error(`[LOGGER] File logging disabled: cannot access log directory "${dirPath}" for writing.`);
    console.error(`[LOGGER] Runtime identity uid=${uid}, gid=${gid}.`);
    console.error(`[LOGGER] Reason: ${error.message}`);
    return false;
  }
}

const FILE_LOGGING_ENABLED = ensureWritableLogDir(LOG_DIR);
const DEFAULT_LOG_MODES = IS_PRODUCTION
  ? new Set(['error', 'application', 'auth'])
  : new Set(['error', 'application', 'debug', 'auth']);
const ENV_LOG_MODES = parseLogModes(process.env.LOG_MODES);
const ENABLED_LOG_MODES = ENV_LOG_MODES || DEFAULT_LOG_MODES;
const ACCESS_LOGGING_ENABLED = parseBoolean(process.env.LOG_ACCESS_ENABLED, false);
const AUTH_LOGGING_ENABLED = parseBoolean(process.env.LOG_AUTH_ENABLED, ENABLED_LOG_MODES.has('auth'));

// Log-Level Definition
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

const LOG_LEVEL_FROM_ENV = String(process.env.LOG_LEVEL || 'INFO').toUpperCase();
const CURRENT_LOG_LEVEL = LOG_LEVELS[LOG_LEVEL_FROM_ENV] === undefined ? 'INFO' : LOG_LEVEL_FROM_ENV;

class Logger {
  constructor() {
    this.logStreams = {};
    this.initializeStreams();
  }

  initializeStreams() {
    if (!FILE_LOGGING_ENABLED) {
      this.logStreams = {};
      return;
    }

    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Verschiedene Log-Dateien für verschiedene Zwecke
    this.logStreams = {};
    if (ENABLED_LOG_MODES.has('error')) {
      this.logStreams.error = createWriteStream(join(LOG_DIR, `error-${date}.log`), { flags: 'a' });
    }
    if (ENABLED_LOG_MODES.has('application')) {
      this.logStreams.application = createWriteStream(join(LOG_DIR, `app-${date}.log`), { flags: 'a' });
    }
    if (ENABLED_LOG_MODES.has('debug')) {
      this.logStreams.debug = createWriteStream(join(LOG_DIR, `debug-${date}.log`), { flags: 'a' });
    }
    if (AUTH_LOGGING_ENABLED) {
      this.logStreams.auth = createWriteStream(join(LOG_DIR, `auth-${date}.log`), { flags: 'a' });
    }
    if (ACCESS_LOGGING_ENABLED) {
      this.logStreams.access = createWriteStream(join(LOG_DIR, `access-${date}.log`), { flags: 'a' });
    }

    // Fehlerbehandlung für Streams
    Object.values(this.logStreams).forEach(stream => {
      stream.on('error', (err) => {
        console.error('Log stream error:', err);
      });
    });
  }

  formatMessage(level, message, extra = null) {
    const timestamp = new Date().toISOString();
    const baseMessage = `[${timestamp}] [${level}] ${message}`;

    if (extra) {
      return `${baseMessage} ${JSON.stringify(extra)}`;
    }
    return baseMessage;
  }

  static sanitizeStructuredValue(value) {
    if (value === null || value === undefined) return '-';
    return String(value)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/[\r\n\t]+/g, ' ')
      .trim();
  }

  formatRfc5424AuthEvent(eventType, fields = {}, severity = 'INFO') {
    const timestamp = new Date().toISOString();
    const appName = Logger.sanitizeStructuredValue(process.env.SYSLOG_APP_NAME || 'expressblog');
    const host = Logger.sanitizeStructuredValue(process.env.SYSLOG_HOSTNAME || process.env.HOSTNAME || 'localhost');
    const procId = process.pid;
    const msgId = Logger.sanitizeStructuredValue(eventType || 'AUTH_EVENT');
    const level = String(severity || 'INFO').toUpperCase();

    const eventFields = {
      event: eventType,
      level,
      ...fields,
    };

    const structuredData = Object.entries(eventFields)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${key}="${Logger.sanitizeStructuredValue(value)}"`)
      .join(' ');

    // PRI 86 = facility authpriv(10) * 8 + severity info(6)
    return `<86>1 ${timestamp} ${host} ${appName} ${procId} ${msgId} [auth@32473 ${structuredData}] auth_event`;
  }

  shouldLog(level) {
    return LOG_LEVELS[level] <= LOG_LEVELS[CURRENT_LOG_LEVEL];
  }

  writeToFile(streamName, message) {
    if (!FILE_LOGGING_ENABLED) return;
    if (this.logStreams[streamName]) {
      this.logStreams[streamName].write(message + '\n');
    }
  }

  // Haupt-Logging-Methoden
  error(message, extra = null) {
    const formatted = this.formatMessage('ERROR', message, extra);
        
    // In Konsole UND Datei schreiben
    console.error(formatted);
    this.writeToFile('error', formatted);
    this.writeToFile('application', formatted);
  }

  warn(message, extra = null) {
    if (!this.shouldLog('WARN')) return;
        
    const formatted = this.formatMessage('WARN', message, extra);
    console.warn(formatted);
    this.writeToFile('application', formatted);
  }

  info(message, extra = null) {
    if (!this.shouldLog('INFO')) return;
        
    const formatted = this.formatMessage('INFO', message, extra);
    console.log(formatted);
    this.writeToFile('application', formatted);
  }

  debug(message, extra = null) {
    if (!this.shouldLog('DEBUG')) return;
        
    const formatted = this.formatMessage('DEBUG', message, extra);
    console.log(formatted);
    this.writeToFile('debug', formatted);
    this.writeToFile('application', formatted);
  }

  // Spezielle Logging-Methoden
  access(method, url, status, responseTime, ip) {
    if (!ACCESS_LOGGING_ENABLED) return;
    const message = `${ip} "${method} ${url}" ${status} ${responseTime}ms`;
    const formatted = this.formatMessage('ACCESS', message);
    this.writeToFile('access', formatted);
  }

  auth(message, user = null, ip = null) {
    if (!AUTH_LOGGING_ENABLED) return;
    const extra = {};
    if (user) extra.user = user;
    if (ip) extra.ip = ip;

    const formatted = this.formatMessage('AUTH', message, extra);
    console.log(formatted);
    this.writeToFile('auth', formatted);
    this.writeToFile('application', formatted);
  }

  authEvent(eventType, fields = {}, severity = 'INFO') {
    if (!AUTH_LOGGING_ENABLED) return;
    const normalizedSeverity = String(severity || 'INFO').toUpperCase();
    const formatted = this.formatRfc5424AuthEvent(eventType, fields, normalizedSeverity);

    if (normalizedSeverity === 'ERROR') {
      console.error(formatted);
    } else if (normalizedSeverity === 'WARN') {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }

    this.writeToFile('auth', formatted);
    this.writeToFile('application', formatted);
  }

  isAccessLoggingEnabled() {
    return ACCESS_LOGGING_ENABLED;
  }

  // Dateirotation (täglich)
  rotateLogFiles() {
    if (!FILE_LOGGING_ENABLED) return;

    const currentDate = new Date().toISOString().split('T')[0];
    const expectedFile = join(LOG_DIR, `app-${currentDate}.log`);
        
    // Wenn Datum geändert hat, neue Streams erstellen
    if (!existsSync(expectedFile)) {
      Object.values(this.logStreams).forEach(stream => {
        stream.end();
      });
      this.initializeStreams();
    }
  }

  // Graceful shutdown: resolves once buffered lines are flushed to disk
  close() {
    return Promise.all(Object.values(this.logStreams).map(stream =>
      new Promise(resolve => stream.end(resolve)),
    ));
  }
}
// Singleton Logger exportieren
const logger = new Logger();

// Tägliche Rotation
const rotationTimer = setInterval(() => {
  logger.rotateLogFiles();
}, 60 * 60 * 1000); // Jede Stunde prüfen
// Housekeeping only: must not keep scripts or test runs alive on its own
rotationTimer.unref?.();

// Streams are closed by the graceful shutdown in server.js (logger.close()),
// after the last shutdown messages have been written.

export default logger;
