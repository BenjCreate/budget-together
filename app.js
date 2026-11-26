import { projectUrl, publishableKey } from "./config.js";
import { summarize } from "./budget.js";

const demo = !projectUrl && !publishableKey;
const get = (id) => document.getElementById(id);
const localDate = (offset = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return new Intl.DateTimeFormat("sv-SE", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
};
const money = (amount) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount / 100);
const defaultPlan = { start_date: localDate(), next_date: localDate(14), opening: demo ? 350000 : 0, bills: demo ? 90000 : 0, target: demo ? 45000 : 0 };
const sample = [{ id: "sample", kind: "expense", amount: 27500, category: "Groceries", person: "Shared", entry_date: localDate() }];
const storage = "budget-together-demo-v1";
const planForm = get("plan");
const entryForm = get("entry");
let client;
let owner = null;
let editing = null;
let state;
let authVersion = 0;

const navLinks = [...document.querySelectorAll("[data-view]")];
const panels = [...document.querySelectorAll("[data-panel]")];

function showView() {
  const requested = location.hash.slice(1);
  const current = navLinks.some((link) => link.dataset.view === requested) ? requested : "overview";
  for (const link of navLinks) {
    if (link.dataset.view === current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  for (const panel of panels) panel.hidden = panel.dataset.panel !== current;
}

window.addEventListener("hashchange", showView);
showView();

function message(text) {
  get("status").textContent = text;
  get("status").hidden = !text;
}

function check(result) {
  if (result.error) throw result.error;
  return result.data;
}

async function loadEntries(account) {
  const entries = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const query = client.from("budget_entries").select("*").eq("owner", account);
    const page = check(await query.order("id").range(offset, offset + pageSize - 1));
    entries.push(...page);
    if (page.length < pageSize) return entries;
  }
}

async function load(account, version) {
  let next;
  if (demo) {
    next = JSON.parse(localStorage.getItem(storage)) ?? { plan: { ...defaultPlan }, entries: [...sample] };
  } else {
    const planRequest = client.from("budget_plan").select("*").eq("owner", account).maybeSingle();
    const [plan, entries] = await Promise.all([planRequest, loadEntries(account)]);
    next = { plan: check(plan) ?? { ...defaultPlan }, entries };
  }
  if (version !== authVersion) return;
  state = next;
  render();
}

function sortedEntries() {
  return [...state.entries].sort((a, b) => b.entry_date.localeCompare(a.entry_date));
}

const transactionTypes = new Map(
  [...entryForm.elements.kind.options].map(({ value, textContent }) => [value, textContent])
);

const personLabels = new Map(
  [...entryForm.elements.person.options].map(({ value, textContent }) => [value, textContent])
);

function render() {
  for (const [key, value] of Object.entries(state.plan)) {
    const field = planForm.elements.namedItem(key);
    if (field) field.value = typeof value === "number" ? value / 100 : value;
  }
  const totals = summarize(state.plan, state.entries);
  get("available").textContent = money(totals.available);
  const summary = get("summary");
  summary.replaceChildren();
  for (const [label, value] of [
    ["Total salary this cutoff", totals.salary], ["Total income this cutoff", totals.income],
    ["Cash on hand", totals.cash], ["Still reserved", totals.reserved],
    ["Piggy bank this cutoff", totals.savings], ["Card payments this cutoff", totals.card_payment]
  ]) {
    const block = document.createElement("div");
    const amount = document.createElement("strong");
    block.textContent = label;
    amount.textContent = money(value);
    block.append(amount);
    summary.append(block);
  }
  const history = get("history");
  history.replaceChildren();
  get("historyNote").hidden = state.entries.length > 0;
  get("downloadHistory").hidden = state.entries.length === 0;
  for (const entry of sortedEntries()) {
    const item = document.createElement("li");
    item.className = "row";
    const text = document.createElement("div");
    const detail = document.createElement("small");
    text.textContent = money(entry.amount) + " · " + entry.category;
    const type = transactionTypes.get(entry.kind);
    detail.textContent = entry.entry_date + " · " + type + " · " + personLabels.get(entry.person);
    text.append(detail);
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "secondary";
    edit.textContent = "Edit";
    edit.onclick = () => {
      editing = entry.id;
      for (const key of ["kind", "category", "person", "entry_date"]) entryForm.elements[key].value = entry[key];
      entryForm.elements.amount.value = entry.amount / 100;
      get("entryTitle").textContent = "Edit transaction";
      get("saveEntry").textContent = "Save changes";
      get("cancel").hidden = false;
      location.hash = "add";
      showView();
      entryForm.elements.amount.focus();
    };
    item.append(text, edit);
    history.append(item);
  }
}

function resetEntry() {
  editing = null;
  entryForm.reset();
  entryForm.elements.entry_date.value = localDate();
  get("entryTitle").textContent = "Add transaction";
  get("saveEntry").textContent = "Add transaction";
  get("cancel").hidden = true;
}

function action(element, event, run) {
  element.addEventListener(event, async (e) => {
    e.preventDefault();
    const button = element.matches("button") ? element : element.querySelector("button");
    button.disabled = true;
    try { await run(); }
    catch (error) { message(error.message || "Something went wrong. Try again."); }
    finally { button.disabled = false; }
  });
}

action(planForm, "submit", async () => {
  const plan = Object.fromEntries(new FormData(planForm));
  if (plan.start_date >= plan.next_date) throw new Error("Next cutoff must come after the start date.");
  for (const key of ["opening", "bills", "target"]) plan[key] = Math.round(Number(plan[key]) * 100);
  if (demo) {
    state.plan = plan;
    localStorage.setItem(storage, JSON.stringify(state));
  } else {
    check(await client.from("budget_plan").upsert({ ...plan, owner }));
  }
  await load(owner, authVersion);
  message("Cutoff plan saved.");
});

action(entryForm, "submit", async () => {
  const entry = Object.fromEntries(new FormData(entryForm));
  entry.amount = Math.round(Number(entry.amount) * 100);
  const id = editing ?? crypto.randomUUID();
  if (demo) {
    state.entries = [...state.entries.filter((item) => item.id !== id), { ...entry, id }];
    localStorage.setItem(storage, JSON.stringify(state));
  } else if (editing) {
    check(await client.from("budget_entries").update(entry).eq("owner", owner).eq("id", id).select("id").single());
  } else {
    check(await client.from("budget_entries").insert({ ...entry, id, owner }));
  }
  resetEntry();
  await load(owner, authVersion);
  message("Transaction saved.");
});

action(get("downloadHistory"), "click", async () => {
  const version = authVersion;
  const { utils, writeFileXLSX } = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
  await load(owner, version);
  if (version !== authVersion) return;
  const entries = sortedEntries();
  if (!entries.length) {
    message("No transactions to export yet.");
    return;
  }
  const rows = entries.map((entry) => [
    entry.entry_date, transactionTypes.get(entry.kind), entry.category,
    personLabels.get(entry.person), Number(entry.amount) / 100
  ]);
  const worksheet = utils.aoa_to_sheet([["Date", "Type", "Category", "For", "Amount (PHP)"], ...rows]);
  worksheet["!cols"] = [14, 24, 18, 14, 16].map((wch) => ({ wch }));
  worksheet["!autofilter"] = { ref: worksheet["!ref"] };
  for (let row = 2; row <= rows.length + 1; row += 1) worksheet["E" + row].z = "#,##0.00";
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, worksheet, "Transactions");
  writeFileXLSX(workbook, "budget-history-" + localDate() + ".xlsx", { compression: true });
  message("Excel download started.");
});

const calculator = get("calculator");
const transactionAmount = entryForm.elements.amount;
const operations = {
  "+": (a, b) => a + b,
  "-": (a, b) => a - b,
  "*": (a, b) => a * b,
  "/": (a, b) => a / b
};
let display = "0";
let operand = 0;
let operator = null;
let replaceDisplay = false;

function displayNumber(value) {
  return Number.isFinite(value) ? String(Number(value.toPrecision(12))) : "Error";
}

function updateCalculator() {
  get("calculatorOutput").textContent = display;
  const current = Number(display);
  const result = operator && !replaceDisplay ? Number(displayNumber(operations[operator](operand, current))) : current;
  const amount = Math.round(result * 100);
  get("useCalculatorAmount").disabled = !Number.isFinite(amount) || amount < 1 || amount > 10000000000;
}

function calculateKey(key) {
  if (key === "AC") {
    display = "0";
    operator = null;
    replaceDisplay = false;
  } else if (/^[0-9.]$/.test(key)) {
    if (replaceDisplay || display === "Error") display = "0";
    replaceDisplay = false;
    if (key === "." && !display.includes(".")) display += ".";
    else if (key !== "." && display.length < 14) display = display === "0" ? key : display + key;
  } else if (key === "backspace") {
    if (!replaceDisplay && display !== "Error") display = display.slice(0, -1) || "0";
    if (display === "-") display = "0";
  } else if (key === "%") {
    if (display !== "Error") {
      display = displayNumber(Number(display) / 100);
      replaceDisplay = false;
    }
  } else if (key === "=" || Object.hasOwn(operations, key)) {
    if (operator && !replaceDisplay) display = displayNumber(operations[operator](operand, Number(display)));
    operator = key === "=" || display === "Error" ? null : key;
    operand = Number(display);
    replaceDisplay = true;
  }
  updateCalculator();
}

get("openCalculator").onclick = () => {
  calculateKey("AC");
  display = transactionAmount.value || "0";
  replaceDisplay = true;
  updateCalculator();
  calculator.showModal();
};

get("calculatorKeys").onclick = (event) => {
  const button = event.target.closest("[data-key]");
  if (button) calculateKey(button.dataset.key);
};

calculator.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const key = event.key === "Backspace" ? "backspace" : event.key === "Delete" ? "AC" : event.key;
  if (/^[0-9.]$/.test(key) || Object.hasOwn(operations, key) || ["=", "%", "backspace", "AC"].includes(key)) {
    event.preventDefault();
    calculateKey(key);
  }
});

get("useCalculatorAmount").onclick = () => {
  if (operator && !replaceDisplay) calculateKey("=");
  if (get("useCalculatorAmount").disabled) return;
  transactionAmount.value = (Math.round(Number(display) * 100) / 100).toFixed(2);
  calculator.close();
  transactionAmount.focus();
};

get("cancel").onclick = resetEntry;
action(get("refresh"), "click", async () => {
  await load(owner, authVersion);
  message(demo ? "Demo refreshed." : "Transactions refreshed.");
});

async function showSession(session) {
  const version = ++authVersion;
  owner = session?.user.id ?? null;
  get("dashboard").hidden = true;
  get("logout").hidden = !owner;
  get("loginPanel").hidden = Boolean(owner);
  resetEntry();
  if (!owner) return;
  await load(owner, version);
  if (version === authVersion) get("dashboard").hidden = false;
}

async function start() {
  resetEntry();
  if (demo) {
    await load(null, authVersion);
    get("dashboard").hidden = false;
    message("Demo mode. Use sample amounts only. Changes stay in this browser.");
    return;
  }
  if (!projectUrl || !publishableKey) throw new Error("Set both Supabase values in config.js.");
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  client = createClient(projectUrl, publishableKey);
  action(get("login"), "submit", async () => {
    check(await client.auth.signInWithPassword(Object.fromEntries(new FormData(get("login")))));
    get("login").reset();
    message("");
  });
  action(get("logout"), "click", async () => {
    check(await client.auth.signOut({ scope: "local" }));
    message("");
  });
  client.auth.onAuthStateChange((event, session) => {
    if (event === "INITIAL_SESSION" || (session?.user.id ?? null) !== owner) {
      setTimeout(() => showSession(session).catch((error) => message(error.message)), 0);
    }
  });
}

start().catch((error) => message(error.message));








