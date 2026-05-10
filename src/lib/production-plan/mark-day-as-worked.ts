/**
 * Phase 5 "Mark as worked" — flip productionDayLineItems.actuallyWorked
 * to true for every line item on a given date. Migration 0087 added
 * the column (defaults to false).
 */

import { supabase } from "@/lib/supabase";
import { queryClient } from "@/lib/query-client";
import type { ProductionDay, ProductionDayLineItem } from "@/types";

export async function markDayAsWorked(input: {
  iso: string;
  productionDays: ProductionDay[];
  lineItems: ProductionDayLineItem[];
}): Promise<{ touched: number }> {
  const dayId = input.productionDays.find(
    (d) => d.date && d.date.slice(0, 10) === input.iso,
  )?.id;
  if (!dayId) return { touched: 0 };
  const ids = input.lineItems
    .filter((li) => li.productionDayId === dayId && !!li.id)
    .map((li) => li.id!);
  if (ids.length === 0) return { touched: 0 };
  const { error } = await supabase
    .from("productionDayLineItems")
    .update({ actuallyWorked: true })
    .in("id", ids);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["productionDayLineItems"] });
  return { touched: ids.length };
}
