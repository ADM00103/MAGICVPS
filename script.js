/* =========================================================
   Статус-страница сети (в стиле status.zapret.moe)
   Показатели эмулируются как живая сеть и обновляются
   каждые 15 секунд: значения меняются плавно, а не скачками.
   ========================================================= */

const REFRESH_MS = 15000;
const HOUR_TICKS = 240;   // 240 * 15 сек = 1 час
const MAX_HISTORY = 260;

/* ---------- Справочники ---------- */
const COUNTRIES = {
  NL: "Нидерланды",
  RU: "Россия",
  FI: "Финляндия",
  DE: "Германия",
  US: "США",
  LV: "Латвия",
  GB: "Великобритания",
  KZ: "Казахстан",
};

const FLAG_BY_CODE = {
  NL: "🇳🇱", RU: "🇷🇺", FI: "🇫🇮", DE: "🇩🇪",
  US: "🇺🇸", LV: "🇱🇻", GB: "🇬🇧", KZ: "🇰🇿",
};

/* Относительная "заселённость" стран (чем выше, тем больше людей) */
const COUNTRY_WEIGHT = {
  NL: 1.00, RU: 0.92, FI: 0.82, DE: 0.42,
  US: 0.40, LV: 0.24, GB: 0.14, KZ: 0.12,
};

const PROTO_SHARES = [
  { name: "VLESS", share: 0.55 },
  { name: "Hysteria 2", share: 0.20 },
  { name: "AWG 2.0", share: 0.08 },
  { name: "AWG 3.0", share: 0.07 },
  { name: "WireGuard", share: 0.05 },
  { name: "MTProto", share: 0.04 },
  { name: "SOCKS5", share: 0.01 },
];

/* Постоянный состав серверов: имя и страна не меняются, метрики живут */
const SERVER_DEFS = [
  ["Финский сервер Uranus", "FI"],
  ["Финский сервер Neptune", "FI"],
  ["Финский сервер Mercury", "FI"],
  ["us-vdsryzen-8", "US"],
  ["us-vdsryzen-9", "US"],
  ["us-nyc-2", "US"],
  ["us-lax-1", "US"],
  ["de-fra-1", "DE"],
  ["de-fra-3", "DE"],
  ["de-nbg-2", "DE"],
  ["Немецкий сервер Orion", "DE"],
  ["nl-ams-1", "NL"],
  ["nl-ams-2", "NL"],
  ["nl-ams-3", "NL"],
  ["Голландский сервер Vega", "NL"],
  ["ru-msk-1", "RU"],
  ["ru-msk-2", "RU"],
  ["ru-spb-1", "RU"],
  ["Российский сервер Sirius", "RU"],
  ["gb-lon-1", "GB"],
  ["gb-lon-2", "GB"],
  ["Британский сервер Polaris", "GB"],
  ["kz-ala-1", "KZ"],
  ["Казахстанский сервер Deneb", "KZ"],
  ["lv-riga-1", "LV"],
  ["lv-riga-2", "LV"],
  ["Латвийский сервер Rigel", "LV"],
  ["Американский сервер Altair", "US"],
];

/* ---------- Утилиты ---------- */
const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const rndF = (min, max, dec = 1) => Number((Math.random() * (max - min) + min).toFixed(dec));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const walk = (v, step, min, max) => clamp(v + (Math.random() * 2 - 1) * step, min, max);
const fmt = (n) => n.toLocaleString("ru-RU");
const pct = (n) => n.toFixed(1).replace(".", ",") + "%";
const pct2 = (n) => n.toFixed(2).replace(".", ",") + "%";
const signedPct = (n) => (n > 0 ? "+" : "") + pct(n);

function mskNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Moscow" }));
}
function pad(n) { return String(n).padStart(2, "0"); }
function timeStr(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }

/* ---------- Состояние ---------- */
let state = null;
let peopleHistory = [];
let sessionsHistory = [];
let dayDeltaPeople = rndF(-3, 5, 1);
let dayDeltaSessions = rndF(-4, 6, 1);

function initState() {
  const servers = SERVER_DEFS.map(([name, cc], id) => {
    const roll = Math.random();
    const status = roll < 0.74 ? "ok" : roll < 0.93 ? "partial" : "down";
    const baseUsers = Math.round(80 * COUNTRY_WEIGHT[cc] * rndF(0.85, 1.15, 2));
    return {
      id,
      name,
      country: cc,
      history: [],
      status,
      baseUsers,
      users: status === "down" ? rnd(0, 3) : status === "partial" ? baseUsers * 0.35 : baseUsers * rndF(0.9, 1.05, 2),
      sessionFactor: rndF(2.3, 3.4, 2),
      avail30: status === "down" ? rndF(88, 96, 2) : status === "partial" ? rndF(96.5, 99.4, 2) : rndF(99.6, 99.99, 2),
      avail8h: status === "down" ? rndF(55, 85, 2) : status === "partial" ? rndF(90, 98, 2) : rndF(99.4, 100, 2),
      stability: status === "ok" ? rndF(96, 100, 2) : rndF(94, 99, 2),
      speed: status === "down" ? rnd(0, 5) : status === "partial" ? rnd(30, 120) : rnd(70, 320),
      toGoogle: rnd(150, 800),
    };
  });
  servers.forEach(seedServerHistory);
  return { servers };
}

/* Предзаполняем историю на час назад, чтобы "за час" сразу считалось честно */
function seedSeries(target, volatility) {
  const arr = [];
  let v = target * (0.9 + Math.random() * 0.2);
  for (let i = 0; i <= HOUR_TICKS; i++) {
    arr.push(Math.round(v));
    v += (target - v) * 0.03 + (Math.random() * 2 - 1) * volatility;
  }
  arr[arr.length - 1] = Math.round(target);
  return arr;
}

function hourDelta(history) {
  if (history.length > HOUR_TICKS) {
    const old = history[history.length - 1 - HOUR_TICKS];
    const now = history[history.length - 1];
    return old > 0 ? ((now - old) / old) * 100 : 0;
  }
  return 0;
}

function seedServerHistory(s) {
  const n = 32;
  let load = Math.max(0, s.users * 0.6);
  let speed = s.speed;
  for (let i = 0; i < n; i++) {
    load = clamp(load + (Math.random() * 2 - 1) * 6, 0, s.baseUsers * 1.2);
    speed = clamp(speed + (Math.random() * 2 - 1) * 14, 0, 400);
    s.history.push({ load, speed });
  }
  s.history.push({ load: s.users, speed: s.speed });
}

/* ---------- Эволюция сети за один тик ---------- */
function evolve() {
  const servers = state.servers;

  /* Редкий региональный инцидент: "падает" часть серверов одной страны */
  if (Math.random() < 0.0012 && servers.filter((s) => s.status !== "ok").length < 6) {
    const cc = pick(Object.keys(COUNTRIES));
    servers
      .filter((s) => s.country === cc)
      .forEach((s) => {
        if (Math.random() < 0.7) s.status = Math.random() < 0.6 ? "down" : "partial";
      });
  }

  for (const s of servers) {
    /* Переходы статусов (редкие, восстановление быстрее падения) */
    const tr = Math.random();
    if (s.status === "ok") {
      if (tr < 0.003) s.status = "partial";
    } else if (s.status === "partial") {
      if (tr < 0.06) s.status = "ok";
      else if (tr < 0.065) s.status = "down";
    } else {
      if (tr < 0.05) s.status = "partial";
      else if (tr < 0.055) s.status = "ok";
    }

    /* Люди плавно стремятся к цели, зависящей от статуса */
    const target = s.status === "ok" ? s.baseUsers : s.status === "partial" ? s.baseUsers * 0.35 : 0;
    s.users = clamp(s.users + (target - s.users) * 0.25 + (Math.random() * 2 - 1) * 1.5, 0, s.baseUsers * 1.2);
    s.users = Math.round(s.users);
    s.sessions = Math.max(0, Math.round(s.users * s.sessionFactor));

    /* Служебные метрики дрейфуют медленно */
    s.speed = s.status === "down" ? rnd(0, 5) : walk(s.speed, 4, s.status === "partial" ? 30 : 70, 320);
    s.toGoogle = walk(s.toGoogle, 6, 150, 800);
    s.stability = walk(s.stability, 0.05, 94, 100);
    s.avail30 = walk(s.avail30, 0.005, 88, 100);

    s.history.push({ load: s.users, speed: s.speed });
    if (s.history.length > 40) s.history.shift();

    /* Доступность "за 8 ч" подтягивается к уровню, зависящему от текущего статуса */
    const target8 = s.status === "ok" ? 99.7 : s.status === "partial" ? 95 : 75;
    s.avail8h = clamp(s.avail8h + (target8 - s.avail8h) * 0.12 + (Math.random() * 2 - 1) * 0.15, 40, 100);
  }

  /* Дельта "к вчера" дрейфует медленно */
  dayDeltaPeople = walk(dayDeltaPeople, 0.4, -8, 8);
  dayDeltaSessions = walk(dayDeltaSessions, 0.5, -10, 10);

  return buildMetrics();
}

function buildMetrics() {
  const servers = state.servers;
  const ok = servers.filter((s) => s.status === "ok").length;
  const partial = servers.filter((s) => s.status === "partial").length;
  const down = servers.filter((s) => s.status === "down").length;
  const notWorking = partial + down;

  const people = servers.reduce((a, s) => a + s.users, 0);
  const sessions = servers.reduce((a, s) => a + s.sessions, 0);

  /* Страны: сумма людей на серверах каждой страны */
  const byCountry = {};
  servers.forEach((s) => {
    byCountry[s.country] = (byCountry[s.country] || 0) + s.users;
  });
  const countries = Object.entries(byCountry)
    .map(([cc, users]) => ({ code: cc, name: COUNTRIES[cc], users }))
    .sort((a, b) => b.users - a.users);

  /* Протоколы: делим сессии по долям (с лёгким шумом) */
  const shares = PROTO_SHARES.map((p) => clamp(p.share + (Math.random() * 2 - 1) * 0.012, 0.004, 1));
  const shareSum = shares.reduce((a, b) => a + b, 0);
  let rest = sessions;
  const protocols = shares.map((sh, i) => {
    const v = i === shares.length - 1 ? rest : Math.round((sessions * sh) / shareSum);
    rest -= v;
    return { name: PROTO_SHARES[i].name, value: Math.max(0, v), share: (sh / shareSum) * 100 };
  });

  const avail30 = servers.reduce((a, s) => a + s.avail30, 0) / servers.length;
  const avail8 = servers.reduce((a, s) => a + s.avail8h, 0) / servers.length;

  const aiDownCount = servers.filter((s) => s.status !== "ok").length;
  const systemsWarn = clamp(Math.round(2 + partial + down * 0.5 + (Math.random() * 2 - 1)), 0, 8);
  const queuesDelayed = partial > 0 ? clamp(Math.round(partial * 0.4), 0, 2) : 0;
  const incidents = {
    active: clamp(Math.round(down + partial * 0.3 + rnd(0, 2)), 0, 9),
    critical: down >= 2 ? 1 : 0,
  };

  return {
    ok, partial, down, notWorking, total: servers.length,
    countriesCount: new Set(servers.map((s) => s.country)).size,
    people, sessions, countries, protocols,
    avail30, avail8, aiDownCount, systemsWarn, queuesDelayed, incidents,
  };
}

/* ---------- Рендер ---------- */
function render(m) {
  const now = mskNow();

  document.getElementById("clockTime").textContent = timeStr(now);
  document.getElementById("clockSnapshot").textContent = "снимок " + timeStr(now);

  const peopleDeltaH = hourDelta(peopleHistory);
  const sessionsDeltaH = hourDelta(sessionsHistory);

  /* Навигация */
  document.getElementById("nav").innerHTML = `
    <a href="#servers">Серверы<span class="n">${m.total}</span></a>
    <a href="#">Системы<span class="n">${m.systemsWarn}</span></a>
    <a href="#">Очереди<span class="n">${m.queuesDelayed}</span></a>
    <a href="#">Инциденты<span class="n">${m.incidents.active}</span></a>
  `;

  /* Баннер */
  const banner = document.getElementById("banner");
  if (m.down >= 3 || m.incidents.critical > 0) {
    banner.className = "banner critical";
    banner.innerHTML = `
      <span class="banner-icon">🔴</span>
      <div>
        <div class="banner-title">Серьёзный сбой серверов</div>
        <div class="banner-sub">${m.down} из ${m.total} серверов не работают в ${m.countriesCount} странах · обновляется автоматически</div>
      </div>`;
  } else if (m.down >= 1 || m.partial >= 3) {
    banner.className = "banner warning";
    banner.innerHTML = `
      <span class="banner-icon">🟡</span>
      <div>
        <div class="banner-title">Частичные сбои</div>
        <div class="banner-sub">${m.ok} из ${m.total} серверов работают, ${m.notWorking} требуют внимания · обновляется автоматически</div>
      </div>`;
  } else {
    banner.className = "banner ok";
    banner.innerHTML = `
      <span class="banner-icon">🟢</span>
      <div>
        <div class="banner-title">Все системы работают</div>
        <div class="banner-sub">${m.total} серверов в ${m.countriesCount} странах · обновляется автоматически</div>
      </div>`;
  }

  /* Сводка */
  document.getElementById("summary").innerHTML = `
    <div class="summary-card">
      <div class="summary-label">Серверы</div>
      <div class="summary-value"><span class="dot ${m.notWorking ? "red" : "green"}"></span>${m.ok} из ${m.total} работают</div>
      <div class="summary-sub">${m.notWorking} не работают</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Системы</div>
      <div class="summary-value"><span class="dot ${m.systemsWarn ? "amber" : "green"}"></span>${m.systemsWarn} из 24</div>
      <div class="summary-sub">требуют внимания</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Очереди</div>
      <div class="summary-value"><span class="dot ${m.queuesDelayed ? "amber" : "green"}"></span>${m.queuesDelayed}</div>
      <div class="summary-sub">с задержками</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Инциденты</div>
      <div class="summary-value"><span class="dot ${m.incidents.critical ? "red" : "amber"}"></span>${m.incidents.active} активных</div>
      <div class="summary-sub">${m.incidents.critical} критичных</div>
    </div>
  `;

  /* Страны */
  document.getElementById("countries").innerHTML = m.countries
    .map(
      (c) => `
      <div class="country">
        <span class="country-flag">${FLAG_BY_CODE[c.code]}</span>
        <span class="country-name">${c.name}</span>
        <span class="country-value">${fmt(c.users)}</span>
      </div>`
    )
    .join("");
  document.getElementById("countriesNote").textContent =
    m.aiDownCount > 0
      ? `Проблемы: ИИ-доступ не работает на ${m.aiDownCount} серверах.`
      : "Проблем не зафиксировано.";

  /* Основные метрики */
  document.getElementById("stats").innerHTML = `
    <div class="stat">
      <div class="stat-label">Людей онлайн</div>
      <div class="stat-value">${fmt(m.people)}</div>
      <div class="stat-delta"><span class="${peopleDeltaH >= 0 ? "up" : "down"}">${signedPct(peopleDeltaH)}</span> <span class="dim">за час · за сутки</span> <span class="${dayDeltaPeople >= 0 ? "up" : "down"}">${signedPct(dayDeltaPeople)}</span></div>
    </div>
    <div class="stat">
      <div class="stat-label">Сессий</div>
      <div class="stat-value">${fmt(m.sessions)}</div>
      <div class="stat-delta"><span class="${sessionsDeltaH >= 0 ? "up" : "down"}">${signedPct(sessionsDeltaH)}</span> <span class="dim">за час · за сутки</span> <span class="${dayDeltaSessions >= 0 ? "up" : "down"}">${signedPct(dayDeltaSessions)}</span></div>
    </div>
    <div class="stat">
      <div class="stat-label">Серверов работает</div>
      <div class="stat-value">${m.ok}<small>/ ${m.total}</small></div>
      <div class="stat-delta dim">${m.countriesCount} стран · к 8 ч назад ${Math.max(0, m.down)}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Доступность за 30 дней</div>
      <div class="stat-value">${pct2(m.avail30)}</div>
      <div class="stat-delta dim">среднее по серверам · за 8 ч ${pct2(m.avail8)}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Активных инцидентов</div>
      <div class="stat-value">${m.incidents.active}</div>
      <div class="stat-delta dim">${m.incidents.critical} критичных · за сутки +${rnd(30, 70)}, −${rnd(20, 50)}</div>
      <a class="stat-link" href="#">Подробнее →</a>
    </div>
  `;

  /* Telegram-бот */
  document.getElementById("botStatus").innerHTML = `
    <div class="panel-title">Телеграм-бот</div>
    <div class="mini-status green"><span class="pulse"></span>Работает</div>
    <div class="sub-line">текущий процесс: ${pick(["меньше часа", "2 часа", "5 часов", "сутки"])}</div>
    <div class="avail green">99,9${rnd(4, 8)}%</div>
    <div class="avail-dim">Доступность 30 дн</div>
  `;

  /* Скорость реакции */
  const p95reaction = rndF(0.25, 0.45, 2);
  document.getElementById("reaction").innerHTML = `
    <div class="panel-title">Скорость реакции</div>
    <div class="sub-line"><b>p95 ${p95reaction.toFixed(2).replace(".", ",")} с</b> · ${rnd(95, 99)}% ответов быстрее 0,5 с</div>
    <div class="kv"><span>нажатий за неделю</span><b>${fmt(rnd(60000, 75000))}</b></div>
    <div class="kv"><span>медиана</span><b>${rndF(0.07, 0.12, 2).toFixed(2).replace(".", ",")} с</b></div>
    <div class="avail-dim">последние 14 мин · Доступность 24 ч <b style="color:var(--green)">99,8%</b></div>
  `;

  /* Скорость меню */
  const p95menu = rndF(0.8, 1.2, 2);
  document.getElementById("menuSpeed").innerHTML = `
    <div class="panel-title">Скорость меню</div>
    <div class="sub-line"><b>медиана ${rndF(0.22, 0.35, 2).toFixed(2).replace(".", ",")} с</b> · p95 ${p95menu.toFixed(2).replace(".", ",")} с</div>
    <div class="kv"><span>перерисовок за неделю</span><b>${fmt(rnd(65000, 85000))}</b></div>
    <div class="kv"><span>p95</span><b>${p95menu.toFixed(2).replace(".", ",")} с</b></div>
    <div class="avail-dim">последние 14 мин · Доступность 24 ч <b style="color:var(--green)">99,8%</b></div>
  `;

  /* Выдача подписок */
  document.getElementById("vlessSubs").innerHTML = `
    <div class="panel-title">Выдача VLESS-подписок</div>
    <div class="mini-status green"><span class="pulse"></span>все ${rnd(4, 6)} проверки владельцев в норме</div>
    <div class="check-list">
      <div class="check-item">Контроллер VLESS-подписки</div>
      <div class="check-item">Выдача для подписок VLESS</div>
      <div class="check-item">Публичный URL VLESS-подписки</div>
      <div class="check-item">HTTP VLESS-подписки</div>
      <div class="check-item">Ожидание пользователей — vless</div>
    </div>
    <div class="avail-dim">последние 14 мин · Доступность 24 ч <b style="color:var(--green)">100,00%</b></div>
  `;
  document.getElementById("hysteriaSubs").innerHTML = `
    <div class="panel-title">Выдача Hysteria 2-подписок</div>
    <div class="mini-status green"><span class="pulse"></span>все ${rnd(3, 5)} проверки владельцев в норме</div>
    <div class="check-list">
      <div class="check-item">Контроллер Hysteria 2-подписки</div>
      <div class="check-item">Выдача для подписок Hysteria 2</div>
      <div class="check-item">Публичный URL Hysteria 2</div>
      <div class="check-item">HTTP Hysteria 2-подписки</div>
    </div>
    <div class="avail-dim">последние 14 мин · Доступность 24 ч <b style="color:var(--green)">100,00%</b></div>
  `;

  /* Доставка сообщений */
  document.getElementById("delivery").innerHTML = `
    <div class="panel-title">Доставка сообщений</div>
    <div class="mini-status green"><span class="pulse"></span>${rndF(99.5, 100, 1).toFixed(1).replace(".", ",")}% доставлено</div>
    <div class="sub-line">медиана 0 с · <b>${fmt(rnd(140, 210))}</b> доставлено за сутки</div>
    <div class="avail-dim">последние 14 мин · Доступность 24 ч <b style="color:var(--green)">100,00%</b></div>
  `;

  /* Протоколы */
  document.getElementById("protocols").innerHTML = m.protocols
    .map(
      (p) => `
      <div class="protocol">
        <div class="protocol-name">${p.name}</div>
        <div class="protocol-value">${fmt(p.value)}</div>
        <div class="protocol-delta" style="color:var(--text-3)">${pct(p.share)}</div>
      </div>`
    )
    .join("");

  /* Серверы */
  document.getElementById("serverCount").textContent = m.total;
  document.getElementById("serversList").innerHTML = state.servers
    .slice()
    .sort((a, b) => b.users - a.users)
    .map((s) => {
      const statusLabel = s.status === "ok" ? "Работает" : s.status === "partial" ? "Частичный сбой" : "Не работает";
      const aiDown = s.status !== "ok";
      const chips = `
        <span class="proto-chip">VLESS ${Math.round(s.sessions * 0.55)}</span>
        <span class="proto-chip">Hysteria 2 ${Math.round(s.sessions * 0.2)}</span>
        <span class="proto-chip">WARP ${Math.round(s.sessions * 0.08)}</span>
        ${aiDown ? `<span class="proto-chip bad">ИИ-доступ</span>` : `<span class="proto-chip">ИИ-доступ</span>`}`;
      return `
        <div class="server-card">
          <div class="server-main">
            <span class="server-flag">${FLAG_BY_CODE[s.country]}</span>
            <div>
              <div class="server-name">${s.name}</div>
              <div class="server-status ${s.status}">${statusLabel}</div>
            </div>
          </div>
          <div class="server-users">
            <div class="server-users-num">${fmt(s.users)}</div>
            <div class="server-users-sub">человек · ${fmt(s.sessions)} сесс.</div>
          </div>
          <div class="server-graph">
            <div class="spark-head">
              <span class="spark-label load">нагрузка <b>${fmt(s.users)}</b></span>
              <span class="spark-label speed">скорость <b>${fmt(s.speed)} Мбит/с</b></span>
            </div>
            <canvas class="spark" id="spark-${s.id}"></canvas>
          </div>
          <div class="server-detail">
            <div class="server-proto">${chips}</div>
            <div class="server-metrics">
              <span>Доступность <b>${pct2(s.avail30)}</b></span>
              <span>Стабильность <b>${pct2(s.stability)}</b></span>
              <span>Скорость <b>${fmt(s.speed)} Мбит/с</b></span>
              <span>До Google <b>${fmt(s.toGoogle)} Мбит/с</b></span>
            </div>
          </div>
        </div>`;
    })
    .join("");
  drawSparks();

  /* Мета и легенда графика */
  const peak = Math.max(...peopleHistory);
  document.getElementById("chartMeta").innerHTML =
    `пик ${fmt(peak)} чел. · изменения за час ${signedPct(peopleDeltaH)}`;
  document.getElementById("chartLegend").innerHTML = `
    <span class="legend-item"><span class="legend-swatch" style="background:var(--accent)"></span>Люди <b>${fmt(m.people)}</b> <span class="d">${signedPct(peopleDeltaH)}</span></span>
    <span class="legend-item"><span class="legend-swatch" style="background:var(--green)"></span>VLESS <b>${fmt(m.protocols[0].value)}</b> <span class="d">${pct(m.protocols[0].share)}</span></span>
    <span class="legend-item"><span class="legend-swatch" style="background:var(--amber)"></span>Hysteria 2 <b>${fmt(m.protocols[1].value)}</b> <span class="d">${pct(m.protocols[1].share)}</span></span>
  `;
}

/* ---------- График ---------- */
function drawChart() {
  const canvas = document.getElementById("chart");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h = w < 600 ? 180 : 220;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const data = peopleHistory;
  if (data.length < 2) return;

  ctx.clearRect(0, 0, w, h);
  const left = w < 520 ? 34 : 44;
  const pad = { top: 16, right: 10, bottom: 22, left };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const max = Math.max(...data) * 1.12 || 1;
  const min = Math.min(...data) * 0.9;

  const x = (i) => pad.left + (i / (data.length - 1)) * plotW;
  const y = (v) => pad.top + plotH - ((v - min) / (max - min)) * plotH;

  /* Сетка и подписи */
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.fillStyle = "#6b6b78";
  ctx.font = "11px " + getComputedStyle(document.body).fontFamily;
  ctx.lineWidth = 1;
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const val = min + (max - min) * (i / steps);
    const yy = pad.top + plotH - (i / steps) * plotH;
    ctx.beginPath();
    ctx.moveTo(pad.left, yy);
    ctx.lineTo(w - pad.right, yy);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(fmt(Math.round(val)), pad.left - 8, yy + 4);
  }

  /* Область */
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
  grad.addColorStop(0, "rgba(91,140,255,0.35)");
  grad.addColorStop(1, "rgba(91,140,255,0)");

  ctx.beginPath();
  data.forEach((v, i) => {
    const xx = x(i);
    const yy = y(v);
    if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
  });
  ctx.strokeStyle = "#5b8cff";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.stroke();

  ctx.lineTo(x(data.length - 1), pad.top + plotH);
  ctx.lineTo(x(0), pad.top + plotH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
}

/* ---------- Мини-графики нагрузки серверов ---------- */
function drawSpark(canvas, history) {
  if (!history || history.length < 2) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 120;
  const h = 56;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const padX = 2;
  const padY = 4;
  const plotW = w - padX * 2;
  const plotH = h - padY * 2;
  const loadMax = Math.max(...history.map((p) => p.load), 1);
  const speedMax = Math.max(...history.map((p) => p.speed), 1);
  const X = (i) => padX + (i / (history.length - 1)) * plotW;
  const Yload = (v) => padY + plotH - (v / loadMax) * plotH;
  const Yspeed = (v) => padY + plotH - (v / speedMax) * plotH;

  /* Нагрузка — область + линия */
  const grad = ctx.createLinearGradient(0, padY, 0, padY + plotH);
  grad.addColorStop(0, "rgba(91,140,255,0.35)");
  grad.addColorStop(1, "rgba(91,140,255,0)");

  ctx.beginPath();
  history.forEach((p, i) => {
    const xx = X(i);
    const yy = Yload(p.load);
    if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
  });
  ctx.strokeStyle = "#5b8cff";
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.stroke();

  ctx.lineTo(X(history.length - 1), padY + plotH);
  ctx.lineTo(X(0), padY + plotH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  /* Скорость — линия */
  ctx.beginPath();
  history.forEach((p, i) => {
    const xx = X(i);
    const yy = Yspeed(p.speed);
    if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
  });
  ctx.strokeStyle = "#2fd573";
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.stroke();
}

function drawSparks() {
  state.servers.forEach((s) => {
    const canvas = document.getElementById("spark-" + s.id);
    if (canvas) drawSpark(canvas, s.history);
  });
}

/* ---------- Цикл ---------- */
function tick() {
  const m = evolve();
  peopleHistory.push(m.people);
  sessionsHistory.push(m.sessions);
  if (peopleHistory.length > MAX_HISTORY) peopleHistory.shift();
  if (sessionsHistory.length > MAX_HISTORY) sessionsHistory.shift();
  render(m);
  drawChart();
}

/* Часы тикают каждую секунду */
setInterval(() => {
  const now = mskNow();
  document.getElementById("clockTime").textContent = timeStr(now);
  document.getElementById("clockSnapshot").textContent = "снимок " + timeStr(now);
}, 1000);

/* Переключение вкладок и кнопок (декоративное) */
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("tab")) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    e.target.classList.add("active");
  }
  if (e.target.classList.contains("range-btn")) {
    const group = e.target.parentElement;
    group.querySelectorAll(".range-btn").forEach((b) => b.classList.remove("active"));
    e.target.classList.add("active");
  }
});

window.addEventListener("resize", () => { drawChart(); drawSparks(); });

/* Инициализация и запуск */
state = initState();
peopleHistory = seedSeries(state.servers.reduce((a, s) => a + Math.round(s.users), 0), 3);
sessionsHistory = seedSeries(state.servers.reduce((a, s) => a + Math.round(s.users * s.sessionFactor), 0), 8);
tick();
setInterval(tick, REFRESH_MS);
