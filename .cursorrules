# AI Coding Agent Rules
This file defines how all AI assistants must behave in this repository.

## 1. Security
- Always validate server-side input.
- Escape all HTML output.
- Never trust client fields like role, owner, or redirect.
- Apply restrictive CORS (explicit domains only).
- Use CSRF tokens for mutating requests.
- Allow only internal redirects.
- Show generic user errors; log detailed errors server-side.
- Enforce safe file uploads (no ../, validate MIME, limit size).
- Keep dependencies updated; fix high/critical vulnerabilities quickly.
- Apply security headers (CSP, X-Frame-Options, nosniff, etc.).
- Never log sensitive data (credentials, tokens, PII).
- Use parameterized queries; never concatenate SQL strings.

If generated code violates any of these, fix it automatically.

## 2. Naming & Style
**C#:**
- PascalCase: classes, methods, properties, constants, public members.
- camelCase: parameters, local variables, lambda parameters.
- Prefix interfaces with "I", private fields with "_".
- Boolean names: Is/Has/Can/Should/Allows prefix.
- Use ArgumentNullException.ThrowIfNull or guard utilities.

**JavaScript/TypeScript:**
- camelCase for variables and functions.
- kebab-case for CSS classes and element IDs.

**Files & Folders:**
- C#: PascalCase (FileService.cs) | JS/TS: lowercase.dot.delimited (file.service.ts)
- Folders: PascalCase
- C#: One type (class, interface, enum, record) per file. File name must match the type name.

Prefer clarity over brevity. Avoid abbreviations. No Hungarian notation.

## 3. Clean Code & Architecture
- Return early; avoid deep nesting.
- No magic strings/numbers; use constants or config.
- Single responsibility per function. Follow SOLID.
- Avoid boolean flags in parameters; use enums or separate methods.
- Limit parameters to 3; use objects for more.
- Remove dead code. Prefer composition over inheritance.
- Inject via constructor; avoid service locator pattern.
- Use IHttpClientFactory; never instantiate HttpClient directly.
- Use IDbContextFactory<T> for EF Core in singleton/scoped services.
- Prefer interfaces for testability.

**Async (C#):**
- Use ConfigureAwait(false) in library code.
- Pass CancellationToken for long-running operations.
- Avoid async void (except event handlers).
- Use Task.WhenAll for parallel work. Add timeouts to prevent hanging.

**Resources & Logging:**
- Dispose IDisposable with using statements.
- Catch specific exceptions; log with context: logger.Error(ex, "Message {Param}", value).
- Use retry policies (e.g., Polly) for external calls.
- Use structured logging ({@object} for objects, {Property} for values).

## 4. Testing & Workflow
- Test class suffix: "Test" or "Tests".
- Method naming: MethodName_Scenario_ExpectedResult.
- Use mocking frameworks (e.g., Moq). Mirror source structure in test projects.
- Code must pass linters (StyleCop, ESLint, SonarLint) with zero violations.
- PRs require reviewer approval. Branch naming: follow ticket convention (e.g., DL-12345).
- Verify build passes before committing.

## 5. AI Assistant Behavior
- Follow all rules above in generated code.
- When unsure, choose the secure and maintainable option.
- Never relax security rules unless explicitly requested.
- Match existing code style and conventions.
- Prefer minimal, focused changes.
- Verify generated code compiles.
- Follow existing project structure for new files.