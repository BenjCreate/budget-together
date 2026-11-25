export function summarize(plan, entries) {
  const totals = { income: 0, expense: 0, bill: 0, card_charge: 0, card_payment: 0, savings: 0 };
  let salary = 0;
  for (const entry of entries) {
    if (entry.entry_date >= plan.start_date && entry.entry_date < plan.next_date) {
      const amount = Number(entry.amount);
      totals[entry.kind] += amount;
      if (entry.kind === "income" && entry.category === "Salary") salary += amount;
    }
  }
  const cash = Number(plan.opening) + totals.income - totals.expense - totals.bill - totals.card_payment - totals.savings;
  const reserved = Math.max(0, Number(plan.bills) - totals.bill) + Math.max(0, Number(plan.target) - totals.savings);
  return { ...totals, salary, cash, reserved, available: cash - reserved };
}

