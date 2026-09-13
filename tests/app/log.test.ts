import { afterEach, describe, expect, it } from 'vitest';
import {
  configureLogging,
  createLogger,
  debugLoggingRequested,
  type LogEntry,
} from '../../src/app/diagnostics/log';

afterEach(() => {
  configureLogging();
});

describe('development logging', () => {
  it('is on in development builds, and in production only when a developer asks for it', () => {
    expect(debugLoggingRequested({ dev: true, storageValue: null, search: '' })).toBe(true);
    expect(debugLoggingRequested({ dev: false, storageValue: null, search: '' })).toBe(false);
    expect(debugLoggingRequested({ dev: false, storageValue: '1', search: '' })).toBe(true);
    expect(debugLoggingRequested({ dev: false, storageValue: 'true', search: '' })).toBe(true);
    expect(debugLoggingRequested({ dev: false, storageValue: '0', search: '' })).toBe(false);
    expect(debugLoggingRequested({ dev: false, storageValue: null, search: '?debug' })).toBe(true);
    expect(debugLoggingRequested({ dev: false, storageValue: null, search: '?file=a&debug=1' })).toBe(true);
    expect(debugLoggingRequested({ dev: false, storageValue: null, search: '?debugging' })).toBe(false);
  });

  it('writes nothing while off, and scoped entries while on', () => {
    const entries: LogEntry[] = [];
    configureLogging({ enabled: false, sink: (entry) => entries.push(entry) });
    createLogger('tools').error('ignored');
    expect(entries).toEqual([]);

    configureLogging({ enabled: true, sink: (entry) => entries.push(entry) });
    const cause = new Error('boom');
    createLogger('autosave').warn('Autosave failed', cause);
    expect(entries).toEqual([
      { level: 'warn', scope: 'autosave', message: 'Autosave failed', details: [cause] },
    ]);
  });

  it('never throws when the sink fails', () => {
    configureLogging({
      enabled: true,
      sink: () => {
        throw new Error('sink failure');
      },
    });
    expect(() => {
      createLogger('ui').error('still fine');
    }).not.toThrow();
  });
});
