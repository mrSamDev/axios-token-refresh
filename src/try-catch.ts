export type Success<T> = [T, null];
export type Failure<E> = [null, E];

export type Result<T, E> = Success<T> | Failure<E>;
export type PromiseResult<T, E> = Promise<Result<T, E>>;

export type Operation<T> = Promise<T> | (() => T);
export type Output<T, E> = PromiseResult<T, E> | Result<T, E>;

const onSuccess = <T>(value: T): Success<T> => [value, null];
const onFailure = <E>(error: E): Failure<E> => [null, error];

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
