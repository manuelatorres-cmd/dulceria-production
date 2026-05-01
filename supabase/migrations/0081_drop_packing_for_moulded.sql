-- Migration 0081 — Drop "packing" production step from moulded categories
--
-- Packing as a per-batch production phase only ever made sense for bar
-- products (foil wrap / label / box per piece is real production work).
-- For moulded chocolates the pieces ship loose to shop stock, and any
-- box-of-N fulfilment for online orders / customer orders happens at
-- dispatch via markOrderAsPacked() — an order-level action that
-- already exists outside the production pipeline.
--
-- Until now the daily focus card showed a "Packing" tick on every
-- moulded batch, but ticking it did nothing concrete (no stock or
-- packaging movement). Just busywork. This drops the rows so the phase
-- stops appearing on those batches; bars keep theirs.
--
-- Reversible: re-add via /production-steps if a moulded category later
-- needs a packing phase.

DELETE FROM "productionSteps"
 WHERE lower(name) LIKE '%pack%'
   AND "productType" <> 'bar';

NOTIFY pgrst, 'reload schema';
