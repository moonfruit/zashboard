# Earth DNS skip fake IP implementation plan

**Goal:** Stop fake-IP DNS query storms while retaining domain geolocation through the existing REST connection.

**Architecture:** Add optional `skip-fake-ip=true` to sing-box Clash DNS queries. Carry `SkipFakeIP` through DNS routing and acknowledge enforcement with response field `SkipFakeIP`. Keep ordinary queries unchanged. Extract the earth resolver into a pure assembly module.

**Constraints:** No proto changes, dependency changes or release version changes. Feature branches in both checkouts. Existing manual DNS diagnostics remain unchanged.

## Tasks

- [x] Kernel: add failing tests for A/AAAA, legacy/new routing, explicit/final fake-IP transports, asynchronous exchange and ordinary query compatibility; implement `DNSQueryOptions.SkipFakeIP`, rejecting fake-IP default and explicit transports.
- [x] REST: test parameter validation, propagation, acknowledgement and request cancellation; implement parsing in a separate helper and minimally hook `dns.go`.
- [x] Frontend: test cache minimum (5 minutes), failures (30 seconds exponentially backing off to 5 minutes), in-flight deduplication, old-kernel disable, backend isolation and disposal; implement pure resolver and sing-box-specific query adapter.
- [x] Integrate: pass optional `skipFakeIP` through config/driver/API, minimally replace earth DNS code, reset resolver on backend changes and dispose on unmount.
- [x] Verify: focused and full fork tests, type-check, lint of changed files, build, Go DNS and Clash API tests. Review diffs for scope and lifecycle gaps.

## Review focus

- Old kernels ignore unknown query parameters: require acknowledgement before using a sing-box result.
- Fake-IP final transport must fail without querying it in synchronous and asynchronous paths.
- Requests queued before backend switch must not run against the new backend.
- Positive short TTL must not trigger refreshes faster than five minutes.
- Manual queries with no option must preserve both wire request and response format.

## Validation

- Frontend: 36 test files, 222 tests passed; fork type-check, changed-source ESLint and formatting checks passed.
- Frontend production build: `pnpm build:no-fonts`.
- Kernel: `go test ./dns ./experimental/clashapi` and `go test -race ./dns ./experimental/clashapi` passed.
- Kernel executable: `go build -tags with_clash_api -o /tmp/sing-box-dns-skip-fake-ip ./cmd/sing-box` passed.
- HTTP smoke with a temporary kernel and local UDP upstream: ordinary A/AAAA returned fake IP; `skip-fake-ip=true` returned the upstream's real addresses and `SkipFakeIP: true`. Both processes cleaned up.
- Independent review: fixed non-sing-box cache/address-policy compatibility; follow-up review found no remaining important issues.
- Implementation was verified on feature branches; running services were not replaced.
- Delivery authorized: commit both changes, create and merge PRs into each fork's `moonfruit` branch, and wait for fork CI results. sing-box uses the existing `ci` branch Tests workflow after integration; no Release workflow is dispatched.
