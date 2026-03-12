# Project Ops → Scheduler: Production Auth Strategy

**Purpose:** Decide how Project Ops (or other internal callers) should authenticate to the FluidCalendar schedule API (`POST /api/projectops/schedule`) in production, when the caller is a **server** (not a browser with a user session).

**Context:** The route currently uses NextAuth JWT session auth (`authenticateRequest()` in `src/lib/auth/api-auth.ts`). That is appropriate for same-app or same-origin browser requests but is **not** suitable for server-to-server calls from Project Ops to a standalone scheduler service.

---

## Options compared

### Option 1: Reuse existing app session (NextAuth)

- **How it works:** Caller sends the same session cookie or Bearer token that a logged-in user gets from the FluidCalendar app. The route uses `getToken({ req, secret: NEXTAUTH_SECRET })` to resolve `userId`.
- **Pros:** Already implemented; no new secrets or code paths.
- **Cons:** Requires a **user session** in the same auth system. Project Ops and FluidCalendar would need to share the same NextAuth provider, domain, or token issuer. Cross-service calls (Project Ops backend → Scheduler service) have no browser cookie; you would have to either proxy through a user’s browser or mint a service account “user” and manage its session — both brittle and not designed for server-to-server.
- **Verdict:** **Not recommended for production** when Project Ops and the scheduler are separate services. Keep it only for in-app / same-origin dev and manual testing.

---

### Option 2: Internal service token (HMAC-signed)

- **How it works:** Project Ops and the scheduler share a secret. For each request, the caller computes a signature (e.g. HMAC-SHA256 of method + path + body + timestamp) and sends it in a header (e.g. `X-Service-Signature`, `X-Service-Timestamp`). The scheduler verifies the timestamp (replay window) and recomputes the signature; if it matches, the request is treated as an authenticated service call. Optionally, a dedicated `userId` or service identity is passed in a header or in the body for audit.
- **Pros:** No shared user session; designed for server-to-server. Replay protection via timestamp. Request integrity via body signing. No third-party dependency.
- **Cons:** Requires secure distribution and rotation of the shared secret; both sides must implement sign/verify.
- **Verdict:** **Recommended as the primary production pattern** for Project Ops → Scheduler when the scheduler is a separate service or same app with a dedicated code path for service callers.

---

### Option 3: API key (internal services only)

- **How it works:** A static API key (e.g. `SCHEDULER_API_KEY`) is stored in env on both sides. The caller sends it in a header (e.g. `X-API-Key`). The scheduler compares the header to the env value and rejects if missing or wrong.
- **Pros:** Very easy to implement; quick to ship for internal-only use behind a VPN or private network.
- **Cons:** No request integrity; anyone with the key can call the API. Key rotation requires updating all callers. No built-in replay protection.
- **Verdict:** **Acceptable as a quick-start fallback** for internal testing or low-risk internal-only deployments. Prefer Option 2 for any production path that might be exposed or where audit/security is important.

---

### Option 4: mTLS / network-level isolation

- **How it works:** The scheduler is only reachable over a private network (e.g. Railway private networking, VPC). No app-level auth; trust is based on network identity (e.g. client cert or IP allowlist).
- **Pros:** Strong isolation; no auth logic in the app if the network is locked down.
- **Cons:** Tied to hosting/platform; both services must be in the same private network. Doesn’t help if the same endpoint is also called from the browser (you still need a second auth path).
- **Verdict:** **Use in addition to** Option 2 or 3 when both services run on the same private network. Do not rely on it as the only control if the schedule API is ever exposed beyond that network.

---

## Recommendation

| Use case | Recommended |
|----------|-------------|
| **Production: Project Ops → Scheduler (server-to-server)** | **Option 2 (HMAC service token)** |
| **Quick internal / dev testing** | Option 3 (API key) |
| **Same-app or same-origin browser** | Keep current NextAuth session (Option 1) for that path only |
| **Private network + app-level auth** | Option 4 (network) **plus** Option 2 or 3 |

---

## Risks

- **Option 1 in production for server-to-server:** Session expiry, no clear “service” identity, and coupling to a user session make it fragile and hard to audit.
- **Option 3 alone:** Key leakage (env, logs, client code) gives full access; rotate keys and prefer Option 2 where possible.
- **Option 2:** Implement timestamp validation (e.g. reject requests older than 5 minutes) to limit replay; use constant-time comparison for the signature.

---

## Implementation notes

- **Current route** (`src/app/api/projectops/schedule/route.ts`): Only calls `authenticateRequest(request, LOG_SOURCE)` and returns 401 if no session. No API key or HMAC path yet.
- **Suggested change (when implementing):** Before calling `authenticateRequest`, check for a service auth header (e.g. `X-Service-Signature` + `X-Service-Timestamp`, or `X-API-Key`). If present and valid, set a synthetic `userId` (e.g. from env `SCHEDULER_SERVICE_USER_ID` or a dedicated service account ID) and skip NextAuth. Otherwise, fall back to `authenticateRequest` so existing browser/same-app flows still work.
- **Do not** log or expose the shared secret or API key. Store only in env (or secret manager) and use constant-time compare for signatures/keys.

---

## What should not be used in production

- **Relying solely on NextAuth session** for server-to-server calls from Project Ops to the scheduler.
- **Sending a user’s session cookie** from the Project Ops backend to the scheduler (security and lifecycle issues).
- **Hardcoding** API keys or HMAC secrets in code or in repo; use env or a secret manager.
- **Skipping replay protection** for HMAC (e.g. no timestamp or nonce); otherwise a captured request can be replayed.
