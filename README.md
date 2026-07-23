# CARGO TRUCK APP

**Direct Freight. Better Profits.**

CARGO TRUCK APP is a worldwide direct freight marketplace for shippers, trucking companies, fleet dispatchers, drivers, and independent owner-operators. It is designed to reduce unnecessary brokerage overhead while preserving verification, compliance, payment protection, and human approval for consequential decisions.

## Current vertical slice

- Worldwide recommended-load marketplace
- Transparent trip economics, including deadhead, fuel, tolls, labor, and projected net profit
- Fail-closed carrier assignment policy
- Global regions, currencies, units, and cross-border route examples
- Live-shipment interface and Google Maps-ready configuration adapter
- Responsive command-center experience
- Zero production credentials or paid APIs required
- Validated company onboarding for five marketplace roles
- Direct load posting, carrier bidding, and shipper-controlled awards
- Append-only in-process audit events for consequential actions

## Run

```bash
npm start
```

Open `http://localhost:3000`.

## Test

```bash
npm test
```

## Google Maps

Copy `.env.example` to `.env` in your own environment and supply restricted browser/server keys through the deployment secret manager. Never commit keys.

The app does not claim that standard Google routing is commercial-truck-safe worldwide. A dedicated truck-routing provider must validate height, weight, width, hazardous-cargo, low-bridge, and restricted-road constraints before safety-critical navigation is released.

## Human approval gates

No autonomous acceptance of contracts, load assignment, payments, regulated compliance decisions, or route-safety overrides.

## Prototype API

- `POST /api/companies` — onboard a legal entity
- `POST /api/loads` — post a load as an onboarded shipper
- `POST /api/loads/:id/bids` — bid as a carrier or owner-operator
- `POST /api/loads/:id/bids/:bidId/accept` — award with explicit `APPROVE`
- `GET /api/audit` — inspect workflow events

Write requests use `X-Actor-Id` in this development slice. Production must replace it with authenticated sessions, authorization policies, durable storage, idempotency keys, and external verification providers.
