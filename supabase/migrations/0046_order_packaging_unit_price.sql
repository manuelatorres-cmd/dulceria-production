-- =============================================================
-- Dulceria Production — orderPackagingLines.unitPrice
-- Migration 0046
-- =============================================================
--
-- Migration 0035 added "vatRate" to orderPackagingLines and
-- "unitPrice" to orderItems but forgot the matching "unitPrice"
-- column on orderPackagingLines — even though the OrderPackagingLine
-- TypeScript type and the saveOrderPackagingLine hook have been
-- writing it. The mismatch surfaces as:
--   Could not find the 'unitPrice' column of 'orderPackagingLines'
--   in the schema cache (code PGRST204)
-- when the operator tries to add packaging with a per-line price to
-- an order.
--
-- Idempotent — safe to re-run.
-- =============================================================

alter table public."orderPackagingLines"
  add column if not exists "unitPrice" numeric(10,2)
    check ("unitPrice" is null or "unitPrice" >= 0);

notify pgrst, 'reload schema';
