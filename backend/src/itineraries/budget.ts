import {
  BudgetCategory,
  INTERCITY_TRANSPORT,
  SummaryCategory,
} from './itinerary.constants';
import { ItineraryDocument } from './schemas/itinerary.schema';

/** One amount that counts towards the budget (ITN-14) */
export interface BudgetLine {
  dayIndex: number;
  category: SummaryCategory;
  amount: number;
  currency: string;
}

/**
 * ITN-14: every amount that counts towards the budget, in its own currency:
 *  - the day's budget entries
 *  - its activity costs (counted under "activities")
 *  - the intercity transport costs counted on that day (ITN-16)
 */
export function budgetLines(itinerary: ItineraryDocument): BudgetLine[] {
  const lines: BudgetLine[] = [];
  const dayIndex = new Map(itinerary.days.map((d, i) => [d._id.toString(), i]));
  itinerary.days.forEach((day, i) => {
    for (const b of day.budgets) {
      lines.push({ dayIndex: i, category: b.category, amount: b.amount, currency: b.currency });
    }
    for (const a of day.activities) {
      if (a.cost !== undefined && a.cost !== null && a.currency) {
        lines.push({
          dayIndex: i,
          category: BudgetCategory.ACTIVITIES,
          amount: a.cost,
          currency: a.currency,
        });
      }
    }
  });
  for (const t of itinerary.transportCosts) {
    const i = dayIndex.get(t.day.toString());
    if (i !== undefined) {
      lines.push({ dayIndex: i, category: INTERCITY_TRANSPORT, amount: t.amount, currency: t.currency });
    }
  }
  return lines;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Adds converted amounts without floating-point drift (works in cents) */
export function sumAmounts(amounts: number[]): number {
  return round2(amounts.reduce((s, a) => s + Math.round(a * 100), 0) / 100);
}
