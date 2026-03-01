# AGENTS.md

Instructions for AI coding agents working with this codebase.

<!-- opensrc:start -->

## Source Code Reference

Source code for dependencies is available in `opensrc/` for deeper understanding of implementation details.

See `opensrc/sources.json` for the list of available packages and their versions.

Use this source code when you need to understand how a package works internally, not just its types/interface.

### Fetching Additional Source Code

To fetch source code for a package or repository you need to understand, run:

```bash
npx opensrc <package>           # npm package (e.g., npx opensrc zod)
npx opensrc pypi:<package>      # Python package (e.g., npx opensrc pypi:requests)
npx opensrc crates:<package>    # Rust crate (e.g., npx opensrc crates:serde)
npx opensrc <owner>/<repo>      # GitHub repo (e.g., npx opensrc vercel/ai)
```

<!-- opensrc:end -->

# Code Style Guide

This isn't about being right. It's about writing code that doesn't make your teammates wince. Real developers ship code that works, not code that reads like a textbook.

## File Size

Keep files under 200 lines. If you hit that limit, you're doing too much in one place. Split it. A 400-line file is two files pretending to be one.

When you split, group by what changes together. Don't split alphabetically or by some arbitrary pattern. If two functions always get modified in the same PR, they belong in the same file.

## Functions

Write pure functions. Same input, same output, every time. No surprises.

Bad:

```typescript
let counter = 0;
function incrementCounter() {
  counter++; // side effect
  return counter;
}
```

Good:

```typescript
function increment(counter: number): number {
  return counter + 1;
}
```

Side effects make debugging hell. If you need state, make it explicit. Pass it in, return it out. Don't hide it in module scope or class properties that get mutated.

Functions should be idempotent when possible. Call it once, call it ten times, same result. Database writes can't always be idempotent, but reads can. API calls should use idempotency keys. File operations should check before overwriting.

## Comments

Most comments are lies waiting to happen. Code changes, comments don't. Write code that explains itself.

When you do comment, make it count. Explain why, not what. The code already shows what it does.

Bad:

```typescript
// Loop through users and increment their count
for (const user of users) {
  user.count++; // increment count
}
```

Good:

```typescript
// Recount needed after batch delete corrupted totals
for (const user of users) {
  user.count = await recalculateUserCount(user.id);
}
```

Better:

```typescript
for (const user of users) {
  user.count = await recalculateUserCount(user.id);
}
```

If the code isn't obvious, fix the code first. Rename variables. Extract functions. Comments are the last resort, not the first.

### Comment Style

When you must comment, write like you're talking to a peer who knows how to code.

Bad:

```typescript
/**
 * This comprehensive function meticulously processes user data
 * and ensures robust validation of all input parameters to
 * seamlessly integrate with our data processing pipeline.
 */
```

Good:

```typescript
// Stripe webhook signature must be validated before we trust the payload
```

Use active voice. Keep it short. Vary sentence length to avoid that robotic rhythm. No jargon unless it's genuinely shorter than the plain English version.

Never use:

- "ensures"
- "robust"
- "comprehensive"
- "seamlessly"
- "leverages"
- "facilitates"
- "optimized"
- "critical" (unless something actually catches fire)

These words scream AI. Cut them.

No em dashes. Use commas or periods. If your sentence needs an em dash, it's probably two sentences.

No bullet points in code comments unless you're documenting an API contract. Even then, think twice.

### What to Comment

Comment these things:

- Non-obvious algorithms or math
- Workarounds for library bugs (include issue link)
- Business logic that came from a meeting
- Performance tradeoffs you're consciously making
- Security considerations that aren't obvious

Don't comment:

- What a variable holds (name it better)
- What a function does (write a better function name)
- How code works (refactor until it's obvious)
- Type information (TypeScript does this)

## Naming

Names should be obvious. If you need a comment to explain a variable name, the name is wrong.

Bad:

```typescript
const d = new Date(); // current date
const temp = user.email; // temporary storage
const flag = true; // processing flag
```

Good:

```typescript
const now = new Date();
const userEmail = user.email;
const isProcessing = true;
```

Don't abbreviate unless it's industry standard (url, html, db). Your editor has autocomplete. Save the three keystrokes somewhere else.

Boolean variables start with is, has, should, can. Makes conditionals read like English.

```typescript
if (isValid && hasPermission && !isProcessing) {
  // do thing
}
```

## Function Size

Functions should do one thing. If you're using "and" to describe what it does, it does two things. Split it.

Aim for 5-20 lines. Over 50 lines is a code smell. Over 100 lines is a problem.

Bad:

```typescript
async function processUser(user: User) {
  // validate user
  if (!user.email) throw new Error("Missing email");
  if (!user.name) throw new Error("Missing name");

  // check permissions
  const roles = await getRoles(user.id);
  if (!roles.includes("admin")) throw new Error("Unauthorized");

  // update database
  await db.users.update(user.id, { lastLogin: new Date() });

  // send email
  await sendEmail(user.email, "Welcome back");

  // log event
  await logEvent("user_login", user.id);
}
```

Good:

```typescript
async function processUser(user: User) {
  validateUser(user);
  await checkPermissions(user.id);
  await recordLogin(user);
  await notifyUser(user.email);
}
```

Each helper function is now testable in isolation. No mocks needed. Pure functions all the way down.

## Error Handling

Fail fast. Don't catch errors unless you can do something about them.

Bad:

```typescript
try {
  const result = await fetchData();
  return result;
} catch (err) {
  console.log("Error fetching data");
  return null;
}
```

Good:

```typescript
const result = await fetchData(); // let it throw
return result;
```

If you catch, either recover or add context. Don't just log and swallow.

```typescript
try {
  return await fetchData();
} catch (err) {
  throw new Error(`Failed to fetch user ${userId}: ${err.message}`);
}
```

## Types

Use TypeScript properly or don't use it at all. No `any` unless you're dealing with truly dynamic data. Even then, `unknown` is usually better.

Type what you receive, not what you assume. APIs lie. Users lie. Databases lie. Validate at the boundary, trust internally.

```typescript
// At the API boundary
function createUser(body: unknown): User {
  const validated = UserSchema.parse(body); // throws if invalid
  return saveUser(validated);
}

// Internal function can trust the type
function saveUser(user: User): User {
  // no validation needed
  return db.users.create(user);
}
```

## Testing

Tests are documentation that doesn't lie. Write tests that show how code is meant to be used.

Test behavior, not implementation. If you refactor and all tests break, you're testing wrong.

```typescript
// Bad: testing implementation
expect(user.validate).toHaveBeenCalled();

// Good: testing behavior
expect(() => createUser(invalidData)).toThrow();
```

Pure functions are easy to test. Side effects are hard to test. This is not a coincidence.

## Imports

Order imports by stability. Standard library, then third-party, then your own code. Separate with blank lines.

```typescript
import path from "path";
import fs from "fs";

import express from "express";
import mongoose from "mongoose";

import { User } from "./models/User";
import { logger } from "./utils/logger";
```

Absolute imports for cross-cutting concerns (types, utils). Relative imports for nearby files.

## Async/Await

Use async/await, not promises with `.then()`. It's 2025. Callbacks were a mistake we don't repeat.

Await in series when operations depend on each other. Await in parallel when they don't.

```typescript
// Series: second call needs first result
const user = await getUser(id);
const posts = await getPosts(user.id);

// Parallel: independent calls
const [user, settings] = await Promise.all([getUser(id), getSettings(id)]);
```

## Module Structure

Each file exports one main thing. Other exports are helpers that only make sense in that context.

Bad:

```typescript
// utils.ts
export function formatDate() {}
export function validateEmail() {}
export function calculateDistance() {}
export function sortUsers() {}
```

Good:

```typescript
// dateUtils.ts
export function formatDate() {}
export function parseDate() {}

// validation.ts
export function validateEmail() {}
export function validatePhone() {}

// geometry.ts
export function calculateDistance() {}
export function calculateArea() {}
```

## Constants

Constants go at the top of the file or in a dedicated constants file. Name them in SCREAMING_SNAKE_CASE only if they're truly constant across the entire app.

```typescript
const MAX_RETRIES = 3; // global constant
const baseUrl = process.env.API_URL; // config, not constant
```

Magic numbers get names. If you wrote a number that isn't 0, 1, or 2, name it.

Bad:

```typescript
if (users.length > 100) {
  return users.slice(0, 100);
}
```

Good:

```typescript
const MAX_USERS_PER_PAGE = 100;

if (users.length > MAX_USERS_PER_PAGE) {
  return users.slice(0, MAX_USERS_PER_PAGE);
}
```

## Code Review Checklist

Before committing, check:

- File under 200 lines?
- Functions under 50 lines?
- Functions pure (no side effects)?
- Functions idempotent where possible?
- Variable names obvious without comments?
- Comments explain why, not what?
- No AI cliche words (ensures, robust, comprehensive, etc.)?
- Types instead of `any`?
- Errors fail fast?
- Tests test behavior, not implementation?

If you can't check every box, you're not done.
