# Add or Update Audit Reporting Backend API Feature

Proposed skill name: Add or Update Audit Reporting Backend API Feature
Pattern confidence: 88%
Naming confidence: 96%

## When to use
Use this when a change resembles commits with api_route_changed, service_layer_changed, integration_test_changed, especially around src/routes, src/services, tests.

## Why Compactor proposed this
Compactor grouped repeated commits with route, service, and test signals.
- 4 of 25 scanned commits matched this repeated change shape.
- Dominant generic signals: api_route_changed, service_layer_changed, integration_test_changed.
- route, service, and test signals were dominant
- domain terms used for name: audit, report
- rejected noisy terms: route, service, test, src

## Naming explanation
- Generic category selected: Backend API Feature
- Generic fallback: Add or Update Backend API Feature
- Domain terms used: audit, report
- Terms rejected as noisy: route, service, test, src
- route, service, and test signals were dominant
- domain terms used for name: audit, report
- rejected noisy terms: route, service, test, src

## Generic signals detected
- api_route_changed
- service_layer_changed
- integration_test_changed

## Common files/directories
- Common files:
- src/routes/audit-report.ts
- src/services/audit-report.ts
- tests/audit-report.test.ts
- Common directories:
- src/routes
- src/services
- tests

## Repeated terms
- audit
- report

## Nearest examples
- src/routes/audit-report.ts
- src/services/audit-report.ts
- tests/audit-report.test.ts

## Observed changes from diffs
- Observed api_route_changed:POST /audit-report (src/routes/audit-report.ts).
- Observed function_added:auditReport (src/services/audit-report.ts).
- Observed test_case_added:audit report (tests/audit-report.test.ts).

## Validation
- npm test
- npm run typecheck

## Evidence
- `abc1234`: Add audit report route (api_route_changed:GET /audit-report (src/routes/audit-report.ts))
- `def5678`: Update audit report workflow (api_route_changed:POST /audit-report (src/routes/audit-report.ts))

## Possible false positives / needs human review
- Review representative commits to confirm the proposed skill scope before adopting it.
