# Add or Update Backend API Feature

Proposed skill name: Add or Update Backend API Feature
Pattern confidence: 88%
Naming confidence: 92%

## When to use
Use this when a change resembles commits with api_route_changed, service_layer_changed, integration_test_changed, especially around src/routes, src/services, tests.

## Why Compactor proposed this
Compactor grouped repeated commits with route, service, and test signals.
- 4 of 25 scanned commits matched this repeated change shape.
- Dominant generic signals: api_route_changed, service_layer_changed, integration_test_changed.

## Generic signals detected
- api_route_changed
- service_layer_changed
- integration_test_changed

## Common files/directories
- Common files:
- src/routes/orders.ts
- src/services/orderService.ts
- tests/orders.integration.test.ts
- Common directories:
- src/routes
- src/services
- tests

## Repeated terms
- orders
- route
- service

## Nearest examples
- src/routes/orders.ts
- src/services/orderService.ts
- tests/orders.integration.test.ts

## Observed changes from diffs
- Observed api_route_changed:POST /orders (src/routes/orders.ts).
- Observed function_added:createOrder (src/services/orderService.ts).
- Observed test_case_added:creates order (tests/orders.integration.test.ts).

## Validation
- npm test
- npm run typecheck

## Evidence
- `abc1234`: Add order API route (api_route_changed:POST /orders (src/routes/orders.ts))
- `def5678`: Add invoice API route (api_route_changed:POST /invoices (src/routes/invoices.ts))

## Possible false positives / needs human review
- Review representative commits to confirm the proposed skill scope before adopting it.
