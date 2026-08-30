/**
 * Tuple-based error handling. {@link tryCatch} turns thrown errors and rejected
 * promises into a `[value, error]` tuple so callers skip `try`/`catch`.
 *
 * @module
 */

export type Success<T> = [T, null];
export type Failure<E> = [null, E];
export type Result<T, E> = Success<T> | Failure<E>;
export type PromiseResult<T, E> = Promise<Result<T, E>>;
export type Operation<T> = Promise<T> | (() => T);
export type Output<T, E> = PromiseResult<T, E> | Result<T, E>;

const onSuccess = <T>(value: T): Success<T> => [value, null];
const onFailure = <E>(error: E): Failure<E> => [null, error];

/**
 * Wrap a promise or function so errors come back as a tuple instead of
 * throwing. A promise resolves to `[value, null]` or `[null, error]`; a
 * function runs synchronously and returns the tuple directly.
 *
 * @example
 * ```ts
 * const [data, error] = await tryCatch(api.get("/users"));
 * const [parsed, parseError] = tryCatch(() => JSON.parse(input));
 * ```
 */
export function tryCatch<T, E = Error>(operation: Promise<T>): PromiseResult<T, E>;
export function tryCatch<T, E = Error>(operation: () => T): Result<T, E>;
export function tryCatch<T, E = Error>(operation: Operation<T>): Output<T, E> {
  if (operation instanceof Promise) {
    return operation.then(onSuccess).catch(onFailure);
  }

  try {
    return [operation(), null];
  } catch (error) {
    return [null, error as E];
  }
}
