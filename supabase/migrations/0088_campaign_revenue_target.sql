-- ====================================================================
-- 0088 — campaigns.revenueTarget + businessHubCampaignId
-- ====================================================================
--
-- Two new optional fields on `campaigns` to back the Volume planning
-- widget on /campaigns/[id]:
--
--   revenueTarget          — manual revenue goal for the campaign;
--                            compared against projected revenue
--                            (sum of target_units × per-product list price)
--                            in the widget's status line.
--   businessHubCampaignId  — free-text reference to the linked Business
--                            Hub campaign so a follow-up sync hook can
--                            push projected revenue back. Pasted by the
--                            user in the campaign editor.
--
-- Idempotent — `add column if not exists` so re-runs are safe.

alter table public.campaigns
  add column if not exists "revenueTarget" numeric(12,2);

alter table public.campaigns
  add column if not exists "businessHubCampaignId" text;

comment on column public.campaigns."revenueTarget" is
  'Manual revenue goal for the campaign. Compared against projected revenue (sum of target_units × list price) in the /campaigns/[id] Volume planning widget.';

comment on column public.campaigns."businessHubCampaignId" is
  'Free-text reference to a linked Business Hub campaign — used by a one-way sync hook that pushes projected revenue back to the hub.';

notify pgrst, 'reload schema';
