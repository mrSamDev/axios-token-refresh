/**
 * Lightweight tuple-based error handling utilities.
 *
 * This module provides a {@link tryCatch} wrapper that converts thrown errors
 * and rejected promises into a tuple result — `[value, null]` on success or
 * `[null, error]` on failure — so callers can handle errors without
 * `try`/`catch` blocks.
 *
 * @example
 * ```ts
 * import { tryCatch } from "@mrsamdev/axios-token-refresh/try-catch";
 *
 * const [value, error] = await tryCatch(fetchData());
 * if (error) {
 *   console.error(error);
 *   return;
 * }
 * console.log(value);
 * ```
 *
 * @module
 */

/** A successful result: the value is present, the error is `null`. */
export type Success<T> = [T, null];

/** A failed result: the value is `null`, the error is present. */
export type Failure<E> = [null, E];

/** A synchronous result tuple — either {@link Success} or {@link Failure}. */
export type Result<T, E> = Success<T> | Failure<E>;

/** A promise that resolves to a {@link Result} tuple. */
export type PromiseResult<T, E> = Promise<Result<T, E>>;

/** The input accepted by {@link tryCatch}: a promise or a synchronous function. */
export type Operation<T> = Promise<T> | (() => T);

/** The output of {@link tryCatch}: a result tuple or a promise of one. */
export type Output<T, E> = PromiseResult<T, E> | Result<T, E>;

const onSuccess = <T>(value: T): Success<T> => [value, null];
const onFailure = <E>(error: E): Failure<E> => [null, error];

/**
 * Wrap a promise or synchronous function so that errors are returned as a
 * tuple rather than thrown.
 *
 * When given a **promise**, the returned promise resolves to `[value, null]`
 * on success or `[null, error]` on rejection. When given a **function**, the
 * function is called immediately and the result is a synchronous tuple.
 *
 * @typeParam T The success value type.
 * @typeParam E The error type. Defaults to `Error`.
 *
 * @param operation A promise to await, or a function to invoke.
 * @returns A `[value, error]` tuple (synchronous for functions, async for promises).
 *
 * @example
 * ```ts
 * // With a promise
 * const [data, error] = await tryCatch(api.get("/users"));
 *
 * // With a synchronous function
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
