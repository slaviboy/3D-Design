/*
 * Copyright (C) 2026 Stanislav Georgiev
 * https://github.com/slaviboy
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * Development diagnostics. Logging is off in production builds unless a developer turns it on for this browser with
 * `localStorage.setItem('planar.debug', '1')` or by opening Planar with `?debug` in the address. Nothing is ever
 * sent anywhere: the only output is the browser's own developer console.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  readonly level: LogLevel;
  /** The subsystem that logged, for example "tools" or "autosave". */
  readonly scope: string;
  readonly message: string;
  readonly details: readonly unknown[];
}

export type LogSink = (entry: LogEntry) => void;

export interface Logger {
  debug(message: string, ...details: unknown[]): void;
  info(message: string, ...details: unknown[]): void;
  warn(message: string, ...details: unknown[]): void;
  error(message: string, ...details: unknown[]): void;
}

export const DEBUG_STORAGE_KEY = 'planar.debug';
export const DEBUG_QUERY_PARAMETER = 'debug';

/** Whether diagnostics are on: always in development builds, otherwise only when a developer opts in. */
export function debugLoggingRequested(env: {
  readonly dev: boolean;
  readonly storageValue: string | null;
  readonly search: string;
}): boolean {
  if (env.dev) return true;
  if (env.storageValue === '1' || env.storageValue === 'true') return true;
  return new URLSearchParams(env.search).has(DEBUG_QUERY_PARAMETER);
}

function readStorageFlag(): string | null {
  try {
    return localStorage.getItem(DEBUG_STORAGE_KEY);
  } catch {
    // Storage can be unavailable (Node, private mode, sandboxed frames); diagnostics then stay off.
    return null;
  }
}

function readSearch(): string {
  try {
    return location.search;
  } catch {
    return '';
  }
}

function detectEnabled(): boolean {
  return debugLoggingRequested({
    dev: import.meta.env.DEV,
    storageValue: readStorageFlag(),
    search: readSearch(),
  });
}

const consoleSink: LogSink = (entry) => {
  const prefix = `[planar:${entry.scope}] ${entry.message}`;
  /* eslint-disable no-console -- this sink is the one place diagnostics reach the developer console */
  if (entry.level === 'error') console.error(prefix, ...entry.details);
  else if (entry.level === 'warn') console.warn(prefix, ...entry.details);
  else if (entry.level === 'info') console.info(prefix, ...entry.details);
  else console.debug(prefix, ...entry.details);
  /* eslint-enable no-console */
};

let enabled: boolean | null = null;
let sink: LogSink = consoleSink;

/** Replaces where entries go and whether logging is on. For tests; pass nothing to restore the defaults. */
export function configureLogging(
  options: { readonly enabled?: boolean; readonly sink?: LogSink } = {},
): void {
  enabled = options.enabled ?? null;
  sink = options.sink ?? consoleSink;
}

export function isLoggingEnabled(): boolean {
  enabled ??= detectEnabled();
  return enabled;
}

export function createLogger(scope: string): Logger {
  const write =
    (level: LogLevel) =>
    (message: string, ...details: unknown[]): void => {
      if (!isLoggingEnabled()) return;
      try {
        sink({ level, scope, message, details });
      } catch {
        // Diagnostics must never break the application.
      }
    };
  return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') };
}
