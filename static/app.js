const tg = window.Telegram?.WebApp;
const palette = ["#187b58", "#d95f3d", "#2867b2", "#a96a1d", "#6c5ce7", "#008c95"];

const state = {
  month: new Date().toISOString().slice(0, 7),
};

const money = (cents, currency = "USD") =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);

function applyTelegramTheme() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  if (tg.themeParams?.button_color) {
    document.documentElement.style.setProperty("--accent", tg.themeParams.button_color);
  }
}

async function loadSummary() {
  const res = await fetch(`/api/summary?month=${encodeURIComponent(state.month)}`, {
    headers: { "X-Telegram-Init-Data": tg?.initData || "" },
  });
  if (!res.ok) {
    renderError(await res.text());
    return;
  }
  render(await res.json());
}

function render(data) {
  const total = data.categories.reduce((sum, item) => sum + item.spentCents, 0);
  const budgetTotal = data.budgets.reduce((sum, item) => sum + item.budgetCents, 0);
  document.querySelector("#monthLabel").textContent = data.month;
  document.querySelector("#totalSpent").textContent = money(total);
  document.querySelector("#budgetUsed").textContent = budgetTotal ? `${Math.round((total / budgetTotal) * 100)}%` : "0%";
  document.querySelector("#transactionCount").textContent = data.recent.length;

  drawBars(document.querySelector("#categoryChart"), data.categories, "category", "spentCents");
  drawLine(document.querySelector("#dailyChart"), data.daily);
  renderBudgets(data);
  renderRecent(data.recent);
}

function renderBudgets(data) {
  const spentByCategory = new Map(data.categories.map((item) => [item.category, item.spentCents]));
  const root = document.querySelector("#budgets");
  root.innerHTML = data.budgets.length ? "" : "<p>No budgets set. Send /budget food 300 in Telegram.</p>";

  for (const budget of data.budgets) {
    const spent = spentByCategory.get(budget.category) || 0;
    const ratio = budget.budgetCents ? spent / budget.budgetCents : 0;
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <div class="label">
        <strong>${escapeHtml(budget.category)}</strong>
        <span>${money(spent, budget.currency)} of ${money(budget.budgetCents, budget.currency)}</span>
        <div class="progress"><div class="${ratio >= 0.8 ? "warn" : ""}" style="width:${Math.min(100, ratio * 100)}%"></div></div>
      </div>
      <strong class="amount">${Math.round(ratio * 100)}%</strong>
    `;
    root.append(row);
  }
}

function renderRecent(items) {
  const root = document.querySelector("#recent");
  root.innerHTML = items.length ? "" : "<p>No transactions yet.</p>";
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <div class="label">
        <strong>${escapeHtml(item.description)}</strong>
        <span>${escapeHtml(item.category)} · ${escapeHtml(item.account)} · ${item.occurredOn}</span>
      </div>
      <strong class="amount">${money(Math.abs(item.amountCents), item.currency)}</strong>
    `;
    root.append(row);
  }
}

function drawBars(canvas, items, labelKey, valueKey) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const max = Math.max(1, ...items.map((item) => item[valueKey]));
  const barH = 28;
  const gap = 14;
  ctx.font = "15px system-ui";
  items.slice(0, 8).forEach((item, index) => {
    const y = 24 + index * (barH + gap);
    const width = Math.max(4, ((w - 170) * item[valueKey]) / max);
    ctx.fillStyle = palette[index % palette.length];
    ctx.fillRect(130, y, width, barH);
    ctx.fillStyle = getTextColor();
    ctx.fillText(item[labelKey], 0, y + 20);
    ctx.fillText(money(item[valueKey]), 140 + width, y + 20);
  });
  if (!items.length) emptyChart(ctx, w, h);
}

function drawLine(canvas, items) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!items.length) {
    emptyChart(ctx, w, h);
    return;
  }
  const max = Math.max(1, ...items.map((item) => item.spentCents));
  const step = items.length > 1 ? (w - 40) / (items.length - 1) : 0;
  ctx.strokeStyle = palette[2];
  ctx.lineWidth = 4;
  ctx.beginPath();
  items.forEach((item, index) => {
    const x = 20 + index * step;
    const y = h - 28 - ((h - 56) * item.spentCents) / max;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function emptyChart(ctx, w, h) {
  ctx.fillStyle = getMutedColor();
  ctx.font = "15px system-ui";
  ctx.fillText("No data for this month", 18, h / 2);
}

function renderError(message) {
  document.querySelector("#recent").innerHTML = `<p>${escapeHtml(message)}</p>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function getTextColor() {
  return getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#17201b";
}

function getMutedColor() {
  return getComputedStyle(document.documentElement).getPropertyValue("--muted").trim() || "#66736b";
}

document.querySelector("#monthInput").value = state.month;
document.querySelector("#monthInput").addEventListener("change", (event) => {
  state.month = event.target.value || state.month;
  loadSummary();
});

applyTelegramTheme();
loadSummary();

