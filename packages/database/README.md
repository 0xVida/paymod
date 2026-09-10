# Database foundation

`001_budget_reservations.sql` defines the PostgreSQL reservation ledger used by
Paymod before a provider call or chain settlement can occur.

The application transaction sequence is:

1. Lock/update a budget period only if `spent + reserved + requested <= limit`.
2. Insert a reservation with an idempotency key in the same database
   transaction.
3. On success, commit actual usage; on failure/timeout, release the reservation.

Amounts are atomic `NUMERIC(78,0)` values (not floats) and APIs continue to pass
them as integer strings. A future integration test suite will run these queries
against PostgreSQL with concurrent clients.
