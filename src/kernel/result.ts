/** Outcome of an operation on untrusted input, such as parsing, where failure is expected and not exceptional. */
export type Result<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(error: string): Result<T> {
  return { ok: false, error };
}
