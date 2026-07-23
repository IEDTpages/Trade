"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import referenceJson from "./data/reference-data.json";
import comtradeAreaNamesJson from "./data/comtrade-area-names-ru.json";

type Country = { comtradeCode: string; iso: string; alpha2: string; alpha3: string; name: string; nameEn: string };
type Region = { name: string; codes: string[] };
type Commodity4 = { code: string; name: string };
type Commodity6 = Commodity4 & { parent: string };
type ReferenceData = {
  meta: { countries: number; regions: number; hs4: number; hs6: number };
  countries: Country[];
  regions: Region[];
  cargoGroups: string[];
  cargoSubgroups: string[];
  hs4: Commodity4[];
  hs6: Commodity6[];
  groupToHs4: Record<string, string[]>;
  subgroupToHs4: Record<string, string[]>;
  groupToSubgroups: Record<string, string[]>;
};
type Choice = { value: string; label: string; meta?: string };
type DataRow = Record<string, unknown>;
type Metric = "usd" | "tons";
type ProductLevel = "group" | "subgroup" | "hs4" | "hs6";
type Flow = "M" | "X";
type GeoDimension = "reporter" | "partner";
type Point = { label: string; value: number; changeAbs: number | null; changePct: number | null; changeNote?: string };
type FlowSeries = { flow: Flow; label: string; points: Point[] };
type RankedItem = { key: string; label: string; value: number; code?: string; memberKeys?: string[] };
type ProductFilter = { level: ProductLevel; keys: string[]; label: string } | null;
type GeoFilter = { dimension: GeoDimension; code: string; label: string } | null;
type QueueRequest = { params: Record<string, string>; count: number };
type QueueProgress = { phase: "idle" | "planning" | "loading"; completed: number; total: number; rows: number };

const reference = referenceJson as unknown as ReferenceData;
// The permanent backend has no Cloud Functions response-size limit, so each
// authenticated Comtrade request can safely use a much larger batch.
const LIMIT = 50_000;
const CODE_BATCH = 250;
const PERIOD_BATCH = 12;
const ALL_COUNTRIES = "__ALL_COUNTRIES__";
const currentYear = new Date().getFullYear();
const numberFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const compactFormat = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });
const FLOW_LABELS: Record<Flow, string> = { M: "Импорт", X: "Экспорт" };
const FLOW_COLORS: Record<Flow, string> = { M: "#08a6a6", X: "#174ea6" };
const MONTHS_SHORT = ["", "янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const DONUT_COLORS = ["#174ea6", "#08a6a6", "#5a78c9", "#25b991", "#8296d7", "#50c5bd", "#a4b2df", "#79d5bd", "#405eac", "#168d93", "#c6d0e9"];

function normalizeComtradeCode(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  const numeric = Number(digits);
  if (!Number.isFinite(numeric)) return "";
  return String(numeric);
}

// Comtrade-specific historical areas and aggregates supplement the base
// country directory; a base-directory name always has priority.
const COMTRADE_AREA_NAMES_RU: Record<string, string> = Object.fromEntries(
  Object.entries(comtradeAreaNamesJson).map(([code, name]) => [normalizeComtradeCode(code), name]),
);
const COUNTRY_BY_COMTRADE_CODE = new Map(reference.countries.map((country) => [normalizeComtradeCode(country.comtradeCode), country]));
const COUNTRY_BY_ALPHA2 = new Map(reference.countries.filter((country) => country.alpha2).map((country) => [country.alpha2.trim().toUpperCase(), country]));
const COUNTRY_BY_ALPHA3 = new Map(reference.countries.filter((country) => country.alpha3).map((country) => [country.alpha3.trim().toUpperCase(), country]));
const COUNTRY_NAME_RU_BY_ENGLISH = new Map(reference.countries.filter((country) => country.nameEn).map((country) => [country.nameEn.trim().toLowerCase(), country.name]));

function numeric(row: DataRow, ...keys: string[]) {
  for (const key of keys) {
    const value = Number(row[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function metricValue(row: DataRow, metric: Metric) {
  return metric === "usd" ? numeric(row, "primaryValue", "tradeValue") : numeric(row, "netWgt", "netWeight") / 1000;
}

function flowFromRow(row: DataRow): Flow | null {
  const direct = String(row.flowCode ?? "").toUpperCase();
  if (direct === "M" || direct === "X") return direct;
  const legacy = Number(row.rgCode ?? row.flowCodeM49);
  if (legacy === 1) return "M";
  if (legacy === 2) return "X";
  const description = String(row.flowDesc ?? "").toLowerCase();
  if (description.includes("import")) return "M";
  if (description.includes("export")) return "X";
  return null;
}

function countryDescriptionFromRow(row: DataRow, dimension: GeoDimension) {
  for (const key of [`${dimension}Desc`, `${dimension}Name`, `${dimension}Description`]) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function countryCodeFromRow(row: DataRow, dimension: GeoDimension) {
  for (const key of [`${dimension}Code`, `${dimension}CodeM49`, `${dimension}M49`]) {
    const code = normalizeComtradeCode(row[key]);
    if (code) return code;
  }
  const alpha3 = String(row[`${dimension}CodeIsoAlpha3`] ?? row[`${dimension}ISO`] ?? "").trim().toUpperCase();
  if (COUNTRY_BY_ALPHA3.has(alpha3)) return normalizeComtradeCode(COUNTRY_BY_ALPHA3.get(alpha3)?.comtradeCode);
  const alpha2 = String(row[`${dimension}CodeIsoAlpha2`] ?? "").trim().toUpperCase();
  if (COUNTRY_BY_ALPHA2.has(alpha2)) return normalizeComtradeCode(COUNTRY_BY_ALPHA2.get(alpha2)?.comtradeCode);
  return "";
}

function countryKeyFromRow(row: DataRow, dimension: GeoDimension) {
  const code = countryCodeFromRow(row, dimension);
  if (code) return code;
  const description = countryDescriptionFromRow(row, dimension).toLowerCase();
  return description ? `desc:${description}` : "__UNKNOWN_AREA__";
}

function countryLabelFromRow(row: DataRow, dimension: GeoDimension) {
  const code = countryCodeFromRow(row, dimension);
  const directoryCountry = COUNTRY_BY_COMTRADE_CODE.get(code);
  if (directoryCountry) return directoryCountry.name;
  if (COMTRADE_AREA_NAMES_RU[code]) return COMTRADE_AREA_NAMES_RU[code];
  const description = countryDescriptionFromRow(row, dimension);
  const translated = COUNTRY_NAME_RU_BY_ENGLISH.get(description.toLowerCase());
  if (translated) return translated;
  if (description.toLowerCase() === "world") return "Мир";
  return code ? `Страна или территория вне справочника · ${code}` : "Страна или территория не определена";
}

function commodityCodeFromRow(row: DataRow) {
  const raw = String(getValue(row, "cmdCode")).replace(/\D/g, "");
  const level = Number(row.aggrLevel);
  if (level === 4 || level === 6) return raw.padStart(level, "0");
  return raw.length <= 4 ? raw.padStart(4, "0") : raw.padStart(6, "0");
}

function formatMetric(value: number, metric: Metric, compact = false) {
  const formatted = compact ? compactFormat.format(value) : numberFormat.format(value);
  return `${formatted} ${metric === "usd" ? "долл." : "т"}`;
}

function periodParts(row: DataRow) {
  const raw = String(getValue(row, "period", "refPeriodId")).replace(/\D/g, "");
  return { year: raw.slice(0, 4), month: raw.length >= 6 ? Number(raw.slice(4, 6)) : null };
}

function monthlyLabel(months: number[]) {
  const sorted = [...new Set(months)].sort((a, b) => a - b);
  if (!sorted.length) return "месяцы не определены";
  if (sorted.length === 1) return MONTHS_SHORT[sorted[0]];
  const consecutive = sorted.every((month, index) => index === 0 || month === sorted[index - 1] + 1);
  if (consecutive) return `${MONTHS_SHORT[sorted[0]]}–${MONTHS_SHORT[sorted.at(-1) ?? sorted[0]]}`;
  return sorted.map((month) => MONTHS_SHORT[month]).join(", ");
}

function aggregateDynamics(rows: DataRow[], freq: "A" | "M", metric: Metric): FlowSeries[] {
  const dated = rows.map((row) => ({ row, ...periodParts(row) })).filter((item) => /^\d{4}$/.test(item.year));
  const totals = new Map<string, number>();
  const monthsByKey = new Map<string, Set<number>>();
  dated.forEach(({ row, year, month }) => {
    if (freq === "M" && month === null) return;
    const flow = flowFromRow(row);
    if (!flow) return;
    const key = `${flow}:${year}`;
    totals.set(key, (totals.get(key) ?? 0) + metricValue(row, metric));
    if (freq === "M" && month !== null) {
      if (!monthsByKey.has(key)) monthsByKey.set(key, new Set());
      monthsByKey.get(key)?.add(month);
    }
  });
  return (["M", "X"] as Flow[]).map((flow) => {
    const sorted = [...totals].filter(([key]) => key.startsWith(`${flow}:`)).map(([key, value]) => [key.slice(2), value] as const).sort(([a], [b]) => a.localeCompare(b));
    const valuesByYear = new Map(sorted);
    const points = sorted.map(([year, value]) => {
      const previousYear = String(Number(year) - 1);
      const previous = valuesByYear.get(previousYear) ?? null;
      const months = [...(monthsByKey.get(`${flow}:${year}`) ?? [])].sort((a, b) => a - b);
      const previousMonths = [...(monthsByKey.get(`${flow}:${previousYear}`) ?? [])].sort((a, b) => a - b);
      const comparable = freq === "A" || (months.length > 0 && months.join(",") === previousMonths.join(","));
      const canCompare = previous !== null && comparable;
      return {
        label: freq === "M" ? `${year} · ${monthlyLabel(months)}` : year,
        value,
        changeAbs: canCompare ? value - previous : null,
        changePct: canCompare && previous ? ((value - previous) / previous) * 100 : null,
        changeNote: previous === null ? "Нет данных за предыдущий год" : comparable ? undefined : "Набор месяцев отличается от предыдущего года",
      };
    });
    return { flow, label: FLOW_LABELS[flow], points };
  }).filter((series) => series.points.length);
}

function LineChart({ series, metric, activeFlow, onSelect }: { series: FlowSeries[]; metric: Metric; activeFlow: Flow | null; onSelect: (flow: Flow, year: string) => void }) {
  const width = 760, height = 220, left = 60, right = 22, top = 22, bottom = 46;
  const labels = [...new Set(series.flatMap((item) => item.points.map((point) => point.label)))].sort();
  const max = Math.max(1, ...series.flatMap((item) => item.points.map((point) => point.value)));
  const x = (label: string) => labels.length <= 1 ? width / 2 : left + labels.indexOf(label) * ((width - left - right) / (labels.length - 1));
  const y = (value: number) => top + (height - top - bottom) * (1 - value / max);
  return <div className="line-chart">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Динамика в ${metric === "usd" ? "долларах" : "тоннах"}`}>
      {[0, .5, 1].map((share) => <g key={share}><line x1={left} x2={width-right} y1={y(max*share)} y2={y(max*share)} className="grid-line"/><text x={left-8} y={y(max*share)+4} textAnchor="end">{compactFormat.format(max*share)}</text></g>)}
      {series.map((item) => <g key={item.flow} className={cx(activeFlow && activeFlow !== item.flow && "series-muted")}>
        {item.points.length > 1 && (
          <polyline points={item.points.map((point) => `${x(point.label)},${y(point.value)}`).join(" ")} className="trend-line" style={{ stroke: FLOW_COLORS[item.flow] }}/>
        )}
        {item.points.map((point) => <circle key={point.label} cx={x(point.label)} cy={y(point.value)} r="6" className="trend-dot interactive-dot" style={{ stroke: FLOW_COLORS[item.flow] }} tabIndex={0} onClick={() => onSelect(item.flow, point.label.slice(0, 4))} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(item.flow, point.label.slice(0, 4)); }}><title>{item.label}: {formatMetric(point.value, metric)}</title></circle>)}
      </g>)}
      {labels.map((label) => <text key={label} x={x(label)} y={height-20} textAnchor="middle" className="axis-label">{label}</text>)}
    </svg>
    <div className="flow-legend">{series.map((item) => <button type="button" key={item.flow} className={cx(activeFlow === item.flow && "active")} onClick={() => onSelect(item.flow, item.points.at(-1)?.label.slice(0, 4) ?? "")}><i style={{ background: FLOW_COLORS[item.flow] }}/>{item.label}</button>)}</div>
    <div className="change-strip latest-only">{series.map((item) => { const point = item.points.at(-1); return point ? <div key={item.flow}><span>{item.label} · {point.label}</span><b>{formatMetric(point.value, metric, true)}</b><small className={point.changeAbs === null ? "neutral" : point.changeAbs >= 0 ? "positive" : "negative"}>{point.changeAbs === null ? point.changeNote ?? "Нет сопоставимого периода" : `${point.changeAbs >= 0 ? "+" : ""}${formatMetric(point.changeAbs, metric, true)} · ${point.changePct === null ? "—" : `${point.changePct >= 0 ? "+" : ""}${numberFormat.format(point.changePct)}%`}`}</small></div> : null; })}</div>
  </div>;
}

function Ranking({ items, metric, selectedKey, onSelect }: { items: RankedItem[]; metric: Metric; selectedKey?: string; onSelect: (item: RankedItem) => void }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return <div className="ranking">{items.slice(0, 15).map((item, index) => <button type="button" className={cx("rank-row", selectedKey === item.key && "selected")} key={item.key} onClick={() => onSelect(item)}><span className="rank-number">{index + 1}</span><div className="rank-main"><div><b>{item.label}</b>{item.code && <small>{item.code}</small>}<strong>{formatMetric(item.value, metric, true)}</strong></div><span className="rank-track"><i style={{ width: `${item.value / max * 100}%` }}/></span></div></button>)}</div>;
}

function DonutChart({ items, metric, selectedKeys, onSelect }: { items: RankedItem[]; metric: Metric; selectedKeys: string[]; onSelect: (item: RankedItem) => void }) {
  const visible = items.slice(0, 10);
  const remainder = items.slice(10);
  const segments = remainder.length ? [...visible, { key: "__OTHER__", label: "Прочие", value: remainder.reduce((sum, item) => sum + item.value, 0), memberKeys: remainder.flatMap((item) => item.memberKeys ?? [item.key]) }] : visible;
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const polar = (angle: number) => ({ x: 100 + 72 * Math.cos((angle - 90) * Math.PI / 180), y: 100 + 72 * Math.sin((angle - 90) * Math.PI / 180) });
  const pathFor = (start: number, end: number) => { const a = polar(start), b = polar(end); return `M ${a.x} ${a.y} A 72 72 0 ${end - start > 180 ? 1 : 0} 1 ${b.x} ${b.y}`; };
  const chartSegments = segments.map((item, index) => {
    const previous = segments.slice(0, index).reduce((sum, segment) => sum + segment.value, 0);
    const start = total ? previous / total * 359.5 : 0;
    const end = start + (total ? item.value / total * 359.5 : 0);
    return { ...item, start, end, keys: item.memberKeys ?? [item.key] };
  });
  return <div className="donut-layout"><div className="donut-wrap"><svg viewBox="0 0 200 200" role="img" aria-label={`Товарная структура в ${metric === "usd" ? "долларах" : "тоннах"}`}><circle cx="100" cy="100" r="72" className="donut-base"/>{chartSegments.map((item, index) => { const active = item.keys.some((key) => selectedKeys.includes(key)); return <path key={item.key} d={pathFor(item.start, item.end)} className={cx("donut-segment", active && "selected")} style={{ stroke: DONUT_COLORS[index % DONUT_COLORS.length] }} onClick={() => onSelect({ ...item, memberKeys: item.keys })} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect({ ...item, memberKeys: item.keys }); }}><title>{item.label}: {formatMetric(item.value, metric)} ({total ? numberFormat.format(item.value / total * 100) : 0}%)</title></path>; })}<text x="100" y="94" textAnchor="middle" className="donut-caption">Общий объём</text><text x="100" y="112" textAnchor="middle" className="donut-total">{compactFormat.format(total)}</text><text x="100" y="127" textAnchor="middle" className="donut-unit">{metric === "usd" ? "долл. США" : "тонн"}</text></svg></div><div className="donut-legend">{chartSegments.map((item, index) => <button type="button" key={item.key} className={cx(item.keys.some((key) => selectedKeys.includes(key)) && "selected")} onClick={() => onSelect({ ...item, memberKeys: item.keys })}><i style={{ background: DONUT_COLORS[index % DONUT_COLORS.length] }}/><span title={item.label}>{item.label}</span><b>{total ? numberFormat.format(item.value / total * 100) : 0}%</b></button>)}</div></div>;
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    pin: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    box: <><path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="m3 8 9 5 9-5M3 8v8l9 5 9-5V8M12 13v8"/></>,
    code: <><path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
    play: <path d="m8 5 11 7-11 7Z"/>,
    gauge: <><path d="M4.9 19a9 9 0 1 1 14.2 0"/><path d="m12 12 4-3M12 19v.01"/></>,
    download: <><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></>,
    refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    alert: <><path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v4M12 17v.01"/></>,
    key: <><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M15 8l3 3M17 6l2 2"/></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return <label className={cx("field", className)}><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}

function SearchSelect({ value, onChange, choices, placeholder, disabled }: { value: string; onChange: (value: string) => void; choices: Choice[]; placeholder: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = choices.find((choice) => choice.value === value);
  const visible = choices.filter((choice) => `${choice.label} ${choice.meta ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  return <div className={cx("search-select", open && "is-open")}>
    <button type="button" className="select-trigger" disabled={disabled} onClick={() => setOpen(!open)}>
      <span className={cx(!selected && "placeholder")}>{selected?.label ?? placeholder}</span><span className="chevron">⌄</span>
    </button>
    {open && <div className="select-popover">
      <div className="search-box"><Icon name="search" size={16}/><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по названию или коду"/></div>
      <div className="option-list">
        {value && <button type="button" className="option muted-option" onClick={() => { onChange(""); setOpen(false); }}>Очистить выбор</button>}
        {visible.map((choice) => <button type="button" className={cx("option", value === choice.value && "selected")} key={choice.value} onClick={() => { onChange(choice.value); setOpen(false); setQuery(""); }}>
          <span>{choice.label}</span>{choice.meta && <small>{choice.meta}</small>}{value === choice.value && <Icon name="check" size={15}/>} 
        </button>)}
        {!visible.length && <div className="empty-option">Ничего не найдено</div>}
      </div>
    </div>}
  </div>;
}

function MultiSearch({ values, onChange, choices, placeholder }: { values: string[]; onChange: (values: string[]) => void; choices: Choice[]; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const visible = choices.filter((choice) => `${choice.label} ${choice.meta ?? ""}`.toLowerCase().includes(query.toLowerCase())).slice(0, 140);
  const toggle = (value: string) => onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  return <div className={cx("search-select", open && "is-open")}>
    <button type="button" className="select-trigger" onClick={() => setOpen(!open)}>
      <span className={cx(!values.length && "placeholder")}>{values.length ? `Выбрано: ${values.length}` : placeholder}</span><span className="chevron">⌄</span>
    </button>
    {open && <div className="select-popover wide-popover">
      <div className="search-box"><Icon name="search" size={16}/><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Введите код или часть описания"/></div>
      <div className="option-toolbar"><span>{choices.length.toLocaleString("ru-RU")} позиций</span>{values.length > 0 && <button type="button" onClick={() => onChange([])}>Очистить</button>}</div>
      <div className="option-list multi-list">
        {visible.map((choice) => <button type="button" className={cx("option", values.includes(choice.value) && "selected")} key={choice.value} onClick={() => toggle(choice.value)}>
          <span className="checkbox">{values.includes(choice.value) && <Icon name="check" size={13}/>}</span><span><b>{choice.meta}</b> {choice.label}</span>
        </button>)}
        {!visible.length && <div className="empty-option">Ничего не найдено</div>}
      </div>
    </div>}
  </div>;
}

function generatePeriods(freq: "A" | "M", yearFrom: number, yearTo: number, monthFrom: string, monthTo: string) {
  if (freq === "A") {
    if (yearFrom > yearTo) return [];
    return Array.from({ length: yearTo - yearFrom + 1 }, (_, index) => String(yearFrom + index));
  }
  if (!monthFrom || !monthTo || monthFrom > monthTo) return [];
  const result: string[] = [];
  const [startYear, startMonth] = monthFrom.split("-").map(Number);
  const [endYear, endMonth] = monthTo.split("-").map(Number);
  let cursor = new Date(Date.UTC(startYear, startMonth - 1, 1));
  const end = new Date(Date.UTC(endYear, endMonth - 1, 1));
  while (cursor <= end && result.length < 240) {
    result.push(`${cursor.getUTCFullYear()}${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return result;
}

function defaultMonthsForYear(year: number) {
  return Array.from({ length: 12 }, (_, index) => `${year}${String(index + 1).padStart(2, "0")}`);
}

function formatMonthPeriod(period: string) {
  const month = Number(period.slice(4, 6));
  return `${MONTHS_SHORT[month] ?? period.slice(4, 6)} ${period.slice(0, 4)}`;
}

function MonthPeriodPicker({ values, onChange }: { values: string[]; onChange: (values: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const normalizedDraft = draft.replace("-", "");
  const canAdd = /^\d{6}$/.test(normalizedDraft) && !values.includes(normalizedDraft);
  const add = () => {
    if (!canAdd) return;
    onChange([...values, normalizedDraft].sort());
    setDraft("");
  };
  return <div className="month-picker">
    <div className="month-picker-add"><input type="month" min="1962-01" max={`${currentYear}-12`} value={draft} onInput={(event) => setDraft(event.currentTarget.value)} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }}/><button type="button" className="btn secondary" onClick={add} disabled={!canAdd}>Добавить месяц</button></div>
    <div className="month-picker-toolbar"><span>Выбрано: <b>{values.length}</b> · API-пакетов по периодам: {Math.max(1, Math.ceil(values.length / PERIOD_BATCH))}</span>{values.length > 0 && <button type="button" onClick={() => onChange([])}>Очистить</button>}</div>
    {values.length ? <div className="selected-months">{values.map((period) => <button type="button" key={period} onClick={() => onChange(values.filter((item) => item !== period))} title="Удалить период"><span>{formatMonthPeriod(period)}</span> ×</button>)}</div> : <div className="month-picker-empty">Добавьте один или несколько конкретных месяцев.</div>}
  </div>;
}

function chunks<T>(items: T[], size: number): T[][] {
  if (!items.length) return [[]];
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

function commaValues(value: string | undefined) {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function splitInHalf(values: string[]) {
  const middle = Math.ceil(values.length / 2);
  return [values.slice(0, middle), values.slice(middle)];
}

class ApiRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

function extractCount(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const object = payload as Record<string, unknown>;
  for (const key of ["count", "totalRecords", "recordCount"]) {
    const value = Number(object[key]);
    if (Number.isFinite(value)) return value;
  }
  if (Array.isArray(object.data) && object.data.length) return extractCount(object.data[0]);
  return null;
}

function getValue(row: DataRow, ...keys: string[]) {
  for (const key of keys) if (row[key] !== undefined && row[key] !== null) return row[key];
  return "—";
}

function toCsv(rows: DataRow[]) {
  if (!rows.length) return "";
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return `\uFEFF${headers.map(quote).join(";")}\n${rows.map((row) => headers.map((header) => quote(row[header])).join(";")).join("\n")}`;
}

export default function Home() {
  const [freq, setFreq] = useState<"A" | "M">("A");
  const [yearFrom, setYearFrom] = useState(currentYear - 3);
  const [yearTo, setYearTo] = useState(currentYear - 1);
  const [monthFrom, setMonthFrom] = useState(`${currentYear - 1}-01`);
  const [monthTo, setMonthTo] = useState(`${currentYear - 1}-12`);
  const [monthlyPeriodMode, setMonthlyPeriodMode] = useState<"range" | "custom">("range");
  const [selectedMonthlyPeriods, setSelectedMonthlyPeriods] = useState<string[]>(() => defaultMonthsForYear(currentYear - 1));
  const [flowCode, setFlowCode] = useState("M,X");
  const [country1, setCountry1] = useState("");
  const [country2, setCountry2] = useState("0");
  const [region1, setRegion1] = useState("");
  const [region2, setRegion2] = useState("");
  const [cargoGroup, setCargoGroup] = useState("");
  const [cargoSubgroup, setCargoSubgroup] = useState("");
  const [cargoCodeLevel, setCargoCodeLevel] = useState<"hs4" | "hs6">("hs4");
  const [selectedHs4, setSelectedHs4] = useState<string[]>([]);
  const [selectedHs6, setSelectedHs6] = useState<string[]>([]);
  const [productMode, setProductMode] = useState<"TOTAL" | "AG4" | "AG6" | "CUSTOM">("TOTAL");
  const [aggregateByCmdCode, setAggregateByCmdCode] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [availabilityResult, setAvailabilityResult] = useState<{ key: string; values: string[]; error: boolean }>({ key: "", values: [], error: false });
  const [count, setCount] = useState<number | null>(null);
  const [maxBatchCount, setMaxBatchCount] = useState(0);
  const [countSignature, setCountSignature] = useState("");
  const [countState, setCountState] = useState<"idle" | "loading" | "error">("idle");
  const [requestQueue, setRequestQueue] = useState<QueueRequest[]>([]);
  const [queueSignature, setQueueSignature] = useState("");
  const [queueProgress, setQueueProgress] = useState<QueueProgress>({ phase: "idle", completed: 0, total: 0, rows: 0 });
  const [rows, setRows] = useState<DataRow[]>([]);
  const [dataSignature, setDataSignature] = useState("");
  const [dataState, setDataState] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");
  const [messageSignature, setMessageSignature] = useState("");
  const [copied, setCopied] = useState(false);
  const [productLevel, setProductLevel] = useState<ProductLevel>("group");
  const [structureYear, setStructureYear] = useState("");
  const [geoDimension, setGeoDimension] = useState<GeoDimension>("partner");
  const [activeFlow, setActiveFlow] = useState<Flow | null>(null);
  const [geoFilter, setGeoFilter] = useState<GeoFilter>(null);
  const [productFilter, setProductFilter] = useState<ProductFilter>(null);

  const individualCountryChoices = useMemo<Choice[]>(() => reference.countries.map((item) => ({ value: item.comtradeCode, label: item.name, meta: `${item.comtradeCode} · ${item.alpha3}` })), []);
  const countryChoices = useMemo<Choice[]>(() => [{ value: ALL_COUNTRIES, label: "Все страны", meta: `${reference.meta.countries} стран и территорий` }, ...individualCountryChoices], [individualCountryChoices]);
  const partnerChoices = useMemo<Choice[]>(() => [
    { value: ALL_COUNTRIES, label: "Все страны", meta: "все партнёры с детализацией" },
    { value: "0", label: "Мир", meta: "000 · агрегированный итог" },
    ...individualCountryChoices,
  ], [individualCountryChoices]);
  const regionChoices = useMemo<Choice[]>(() => reference.regions.map((item) => ({ value: item.name, label: item.name, meta: `${item.codes.length} стран/территорий` })), []);
  const subgroupToGroup = useMemo(() => Object.fromEntries(
    Object.entries(reference.groupToSubgroups).flatMap(([group, subgroups]) => subgroups.map((subgroup) => [subgroup, group])),
  ) as Record<string, string>, []);
  const selectedProductHs4 = useMemo(() => new Set([
    ...selectedHs4,
    ...reference.hs6.filter((item) => selectedHs6.includes(item.code)).map((item) => item.parent),
  ]), [selectedHs4, selectedHs6]);
  const intersectsSelectedProducts = (codes: string[]) => !selectedProductHs4.size || codes.some((code) => selectedProductHs4.has(code));
  const groupOptions = (cargoSubgroup ? [subgroupToGroup[cargoSubgroup]].filter(Boolean) : reference.cargoGroups)
    .filter((group) => intersectsSelectedProducts(reference.groupToHs4[group] ?? []));
  const subgroupOptions = (cargoGroup ? reference.groupToSubgroups[cargoGroup] ?? [] : reference.cargoSubgroups)
    .filter((subgroup) => intersectsSelectedProducts(reference.subgroupToHs4[subgroup] ?? []));
  const cargoHs4 = useMemo(() => {
    let result: Set<string> | null = null;
    if (cargoGroup) result = new Set(reference.groupToHs4[cargoGroup] ?? []);
    if (cargoSubgroup) {
      const subgroup = new Set(reference.subgroupToHs4[cargoSubgroup] ?? []);
      result = result ? new Set([...result].filter((code) => subgroup.has(code))) : subgroup;
    }
    return result;
  }, [cargoGroup, cargoSubgroup]);

  const hs4Choices = useMemo<Choice[]>(() => reference.hs4
    .filter((item) => !cargoHs4 || cargoHs4.has(item.code))
    .map((item) => ({ value: item.code, label: item.name, meta: item.code })), [cargoHs4]);

  const allowedHs4 = useMemo(() => {
    const explicit = new Set(selectedHs4);
    if (cargoHs4 && selectedHs4.length) return [...cargoHs4].filter((code) => explicit.has(code));
    if (cargoHs4) return [...cargoHs4];
    return selectedHs4;
  }, [cargoHs4, selectedHs4]);
  const allowedHs4Set = useMemo(() => new Set(allowedHs4), [allowedHs4]);
  const hs6Choices = useMemo<Choice[]>(() => reference.hs6.filter((item) => !allowedHs4.length || allowedHs4Set.has(item.parent)).map((item) => ({ value: item.code, label: item.name, meta: item.code })), [allowedHs4.length, allowedHs4Set]);
  const cmdCodes = useMemo(() => {
    if (productMode !== "CUSTOM") return [productMode];
    if (selectedHs6.length) return selectedHs6.filter((code) => {
      const item = reference.hs6.find((candidate) => candidate.code === code);
      return item && (!allowedHs4.length || allowedHs4Set.has(item.parent));
    });
    if (selectedHs4.length) return allowedHs4;
    if (cargoHs4) return cargoCodeLevel === "hs6" ? reference.hs6.filter((item) => cargoHs4.has(item.parent)).map((item) => item.code) : allowedHs4;
    return [];
  }, [productMode, selectedHs6, allowedHs4, allowedHs4Set, cargoHs4, selectedHs4.length, cargoCodeLevel]);

  useEffect(() => {
    if (!cargoHs4) return;
    // Keep selections valid when a parent cargo filter narrows the code tree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedHs4((values) => values.filter((code) => cargoHs4.has(code)));
    setSelectedHs6((values) => values.filter((code) => {
      const item = reference.hs6.find((candidate) => candidate.code === code);
      return Boolean(item && cargoHs4.has(item.parent));
    }));
  }, [cargoHs4]);

  const periods = useMemo(() => {
    if (freq === "M" && monthlyPeriodMode === "custom") return [...selectedMonthlyPeriods].sort();
    return generatePeriods(freq, yearFrom, yearTo, monthFrom, monthTo);
  }, [freq, yearFrom, yearTo, monthFrom, monthTo, monthlyPeriodMode, selectedMonthlyPeriods]);
  const reporterCodes = useMemo(() => region1 ? reference.regions.find((item) => item.name === region1)?.codes ?? [] : country1 && country1 !== ALL_COUNTRIES ? [country1] : [], [country1, region1]);
  const partnerCodes = useMemo(() => region2 ? reference.regions.find((item) => item.name === region2)?.codes ?? [] : country2 === ALL_COUNTRIES ? [] : [country2 || "0"], [country2, region2]);
  const allCountryCodes = useMemo(() => [...new Set(reference.countries.map((item) => item.comtradeCode).filter(Boolean))], []);
  const productBatches = useMemo(() => ["TOTAL", "AG4", "AG6"].includes(cmdCodes[0]) ? [[cmdCodes[0]]] : chunks(cmdCodes, CODE_BATCH), [cmdCodes]);
  const baseParams = useMemo(() => {
    const params: Record<string, string> = { flowCode, partner2Code: "0", customsCode: "C00", motCode: "0" };
    if (aggregateByCmdCode) params.aggregateBy = "cmdCode";
    if (country1 !== ALL_COUNTRIES) params.reporterCode = reporterCodes.join(",");
    if (country2 !== ALL_COUNTRIES) params.partnerCode = partnerCodes.join(",");
    return params;
  }, [reporterCodes, flowCode, partnerCodes, country1, country2, aggregateByCmdCode]);
  const periodBatches = useMemo(() => chunks(periods, PERIOD_BATCH), [periods]);
  const requestParams = useMemo(() => productBatches.flatMap((productBatch) => periodBatches.map((periodBatch) => ({ ...baseParams, period: periodBatch.join(","), cmdCode: productBatch.join(",") }))), [baseParams, productBatches, periodBatches]);
  const isValid = periods.length > 0 && (country1 === ALL_COUNTRIES || reporterCodes.length > 0) && cmdCodes.length > 0;
  const signature = JSON.stringify({ freq, requestParams });
  const effectiveCount = countSignature === signature ? count : null;
  const effectiveMaxBatchCount = countSignature === signature ? maxBatchCount : 0;
  const effectiveQueue = useMemo(() => queueSignature === signature ? requestQueue : [], [queueSignature, signature, requestQueue]);
  const effectiveRows = useMemo(() => dataSignature === signature ? rows : [], [dataSignature, signature, rows]);
  const effectiveMessage = messageSignature === signature ? message : "";
  const availabilityKey = country1 && country1 !== ALL_COUNTRIES && !region1 ? `${freq}:${country1}` : "";
  const availability = availabilityResult.key === availabilityKey ? availabilityResult.values : [];
  const availabilityState = !availabilityKey ? "idle" : availabilityResult.key === availabilityKey ? (availabilityResult.error ? "error" : "idle") : "loading";

  const directUrlParams = effectiveQueue.length ? effectiveQueue.map((item) => item.params) : requestParams;
  const directUrls = useMemo(() => directUrlParams.map((params) => {
    const endpoint = apiKey ? "https://comtradeapi.un.org/data/v1/get" : "https://comtradeapi.un.org/public/v1/preview";
    const query = new URLSearchParams({ ...params, maxRecords: apiKey ? String(LIMIT) : "500", format: "JSON", includeDesc: "true" });
    if (apiKey) query.set("subscription-key", "[ВАШ_API_КЛЮЧ]");
    return `${endpoint}/C/${freq}/HS?${query.toString()}`;
  }), [directUrlParams, apiKey, freq]);

  useEffect(() => {
    if (!availabilityKey) return;
    let cancelled = false;
    fetchComtrade({ mode: "availability", freq, params: { reporterCode: country1 } })
      .then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload?.error || "Ошибка UN Comtrade"); return payload; })
      .then((payload) => {
        if (cancelled) return;
        const data = Array.isArray(payload?.data) ? payload.data : [];
        const values = [...new Set<string>(data.map((item: DataRow) => String(item.period ?? item.refPeriodId ?? "")).filter(Boolean))].sort((a, b) => b.localeCompare(a)).slice(0, 8);
        setAvailabilityResult({ key: availabilityKey, values, error: false });
      })
      .catch(() => { if (!cancelled) setAvailabilityResult({ key: availabilityKey, values: [], error: true }); });
    return () => { cancelled = true; };
  }, [country1, freq, availabilityKey]);

  async function callApi(mode: "count" | "data", params: Record<string, string>) {
    const response = await fetchComtrade({ mode, freq, params, subscriptionKey: apiKey });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) return payload;
    const message = payload?.error || payload?.message || `HTTP ${response.status}`;
    throw new ApiRequestError(message, response.status);
  }

  function splitRequest(params: Record<string, string>): [Record<string, string>, Record<string, string>] | null {
    const splitParameter = (name: string, fallback: string[] = []) => {
      const current = commaValues(params[name]);
      const values = current.length > 1 ? current : !current.length ? fallback : [];
      if (values.length <= 1) return null;
      const [left, right] = splitInHalf(values);
      return [{ ...params, [name]: left.join(",") }, { ...params, [name]: right.join(",") }] as [Record<string, string>, Record<string, string>];
    };

    for (const candidate of [
      splitParameter("flowCode"),
      splitParameter("reporterCode", country1 === ALL_COUNTRIES ? allCountryCodes : []),
      splitParameter("partnerCode", country2 === ALL_COUNTRIES ? allCountryCodes : []),
      splitParameter("period"),
      splitParameter("cmdCode"),
    ]) if (candidate) return candidate;

    const commodity = params.cmdCode;
    const expanded = commodity === "AG6"
      ? reference.hs6.map((item) => item.code)
      : ["AG4", "TOTAL"].includes(commodity)
        ? reference.hs4.map((item) => item.code)
        : [];
    if (expanded.length > 1) {
      const [left, right] = splitInHalf(expanded);
      return [{ ...params, cmdCode: left.join(",") }, { ...params, cmdCode: right.join(",") }];
    }
    return null;
  }

  async function checkCount() {
    setMessageSignature(signature);
    if (!isValid) { setMessage("Заполните период и выберите Страну 1 или Регион 1."); return; }
    setCountSignature(signature); setQueueSignature(signature); setCountState("loading"); setMessage(""); setCount(0); setMaxBatchCount(0); setRequestQueue([]);
    let total = 0;
    let largest = 0;
    let checksCompleted = 0;
    let checksPlanned = requestParams.length;
    setQueueProgress({ phase: "planning", completed: 0, total: checksPlanned, rows: 0 });
    try {
      const resolved: QueueRequest[] = [];
      const resolvePart = async (params: Record<string, string>, depth = 0): Promise<void> => {
        if (depth > 24) throw new Error("Достигнут предел автоматического разбиения запроса.");
        let part: number | null = null;
        try {
          const payload = await callApi("count", params);
          part = extractCount(payload);
          if (part === null) {
            const payloadObject = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
            const upstreamMessage = String(payloadObject.error ?? payloadObject.message ?? "API не вернул число строк.");
            throw new ApiRequestError(upstreamMessage, 422);
          }
        } catch (error) {
          const canSplitError = error instanceof ApiRequestError && [400, 413, 414, 422].includes(error.status);
          const split = canSplitError ? splitRequest(params) : null;
          checksCompleted += 1;
          if (!split) throw error;
          checksPlanned += 2;
          setQueueProgress({ phase: "planning", completed: checksCompleted, total: checksPlanned, rows: total });
          for (const child of split) await resolvePart(child, depth + 1);
          return;
        }
        checksCompleted += 1;
        if (part > LIMIT) {
          const split = splitRequest(params);
          if (!split) throw new Error(`Одна неделимая часть содержит ${part.toLocaleString("ru-RU")} строк. Сузьте хотя бы один параметр.`);
          checksPlanned += 2;
          setQueueProgress({ phase: "planning", completed: checksCompleted, total: checksPlanned, rows: total });
          for (const child of split) await resolvePart(child, depth + 1);
          return;
        }
        resolved.push({ params, count: part });
        total += part;
        largest = Math.max(largest, part);
        setCount(total); setMaxBatchCount(largest);
        setQueueProgress({ phase: "planning", completed: checksCompleted, total: checksPlanned, rows: total });
      };
      for (const params of requestParams) {
        await resolvePart(params);
      }
      setRequestQueue(resolved);
      setCountState("idle");
      setQueueProgress({ phase: "idle", completed: resolved.length, total: resolved.length, rows: total });
      setMessage(`Очередь готова: ${total.toLocaleString("ru-RU")} строк, ${resolved.length.toLocaleString("ru-RU")} последовательных запросов. Каждая часть укладывается в лимит.`);
    } catch (error) {
      setCountState("error"); setCount(null); setMaxBatchCount(0); setRequestQueue([]); setQueueProgress({ phase: "idle", completed: 0, total: 0, rows: total }); setMessage(error instanceof Error ? error.message : "Не удалось построить очередь.");
    }
  }

  async function runQuery() {
    setMessageSignature(signature);
    if (!effectiveQueue.length) { setMessage("Сначала проверьте объём и сформируйте очередь запросов."); return; }
    setDataSignature(signature); setDataState("loading"); setMessage(""); setRows([]);
    try {
      const batches = apiKey ? effectiveQueue : effectiveQueue.slice(0, 1);
      const result: DataRow[] = [];
      setQueueProgress({ phase: "loading", completed: 0, total: batches.length, rows: 0 });
      for (let index = 0; index < batches.length; index += 1) {
        const payload = await callApi("data", batches[index].params);
        if (Array.isArray(payload?.data)) result.push(...payload.data);
        setRows([...result]);
        setQueueProgress({ phase: "loading", completed: index + 1, total: batches.length, rows: result.length });
      }
      setRows(result); setDataState("idle"); setQueueProgress({ phase: "idle", completed: batches.length, total: batches.length, rows: result.length });
      if (apiKey) setMessage(`Готово: последовательно выполнено ${batches.length.toLocaleString("ru-RU")} запросов, объединено ${result.length.toLocaleString("ru-RU")} строк.`);
      if (!apiKey) setMessage("Показан публичный предпросмотр: максимум 500 строк первого пакета. Для полного выполнения последовательной очереди добавьте API-ключ UN Comtrade.");
    } catch (error) {
      setDataState("error"); setQueueProgress((current) => ({ ...current, phase: "idle" })); setMessage(error instanceof Error ? error.message : "Не удалось получить данные.");
    }
  }

  function downloadCsv() {
    const blob = new Blob([toCsv(effectiveRows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `un-comtrade-${periods[0]}-${periods.at(-1)}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  async function copyUrls() {
    await navigator.clipboard.writeText(directUrls.join("\n")); setCopied(true); window.setTimeout(() => setCopied(false), 1600);
  }

  const country1Name = country1 === ALL_COUNTRIES ? "Все страны" : reference.countries.find((item) => item.comtradeCode === country1)?.name;
  const country2Name = country2 === ALL_COUNTRIES ? "Все страны" : country2 === "0" ? "Мир" : reference.countries.find((item) => item.comtradeCode === country2)?.name;
  const queueReady = effectiveQueue.length > 0;
  const periodSummary = periods.length
    ? freq === "M" && monthlyPeriodMode === "custom"
      ? `${periods.slice(0, 3).map(formatMonthPeriod).join(", ")}${periods.length > 3 ? ` и ещё ${periods.length - 3}` : ""}`
      : `${periods[0]} — ${periods.at(-1)} · ${periods.length}`
    : "Не задан";
  const hs4ToGroup = useMemo(() => {
    const result: Record<string, string> = {};
    Object.entries(reference.groupToHs4).forEach(([name, codes]) => codes.forEach((code) => { if (!result[code]) result[code] = name; }));
    return result;
  }, []);
  const hs4ToSubgroup = useMemo(() => {
    const result: Record<string, string> = {};
    Object.entries(reference.subgroupToHs4).forEach(([name, codes]) => codes.forEach((code) => { if (!result[code]) result[code] = name; }));
    return result;
  }, []);
  const availableYears = useMemo(() => [...new Set(effectiveRows.map((row) => periodParts(row).year).filter((year) => /^\d{4}$/.test(year)))].sort(), [effectiveRows]);
  const effectiveStructureYear = availableYears.includes(structureYear) ? structureYear : availableYears.at(-1) ?? "";
  const productKeyForRow = useCallback((row: DataRow, level: ProductLevel) => {
    const code = commodityCodeFromRow(row);
    const hs4 = code.slice(0, 4);
    if (level === "group") return hs4ToGroup[hs4] ?? "Без группы";
    if (level === "subgroup") return hs4ToSubgroup[hs4] ?? "Без подгруппы";
    if (level === "hs4") return hs4;
    return code;
  }, [hs4ToGroup, hs4ToSubgroup]);
  const matchesProduct = useCallback((row: DataRow, filter: ProductFilter) => !filter || filter.keys.includes(productKeyForRow(row, filter.level)), [productKeyForRow]);
  const matchesGeo = useCallback((row: DataRow, filter: GeoFilter) => !filter || countryKeyFromRow(row, filter.dimension) === filter.code, []);
  const rowsForDynamics = useMemo(() => effectiveRows.filter((row) => matchesGeo(row, geoFilter) && matchesProduct(row, productFilter)), [effectiveRows, geoFilter, productFilter, matchesGeo, matchesProduct]);
  const rowsForGeo = useMemo(() => effectiveRows.filter((row) => periodParts(row).year === effectiveStructureYear && (!activeFlow || flowFromRow(row) === activeFlow) && matchesProduct(row, productFilter) && (!geoFilter || geoFilter.dimension === geoDimension || matchesGeo(row, geoFilter))), [effectiveRows, effectiveStructureYear, activeFlow, productFilter, matchesProduct, geoFilter, geoDimension, matchesGeo]);
  const rowsForProducts = useMemo(() => effectiveRows.filter((row) => periodParts(row).year === effectiveStructureYear && (!activeFlow || flowFromRow(row) === activeFlow) && matchesGeo(row, geoFilter)), [effectiveRows, effectiveStructureYear, activeFlow, geoFilter, matchesGeo]);
  const dynamicsUsd = useMemo(() => aggregateDynamics(rowsForDynamics, freq, "usd"), [rowsForDynamics, freq]);
  const dynamicsTons = useMemo(() => aggregateDynamics(rowsForDynamics, freq, "tons"), [rowsForDynamics, freq]);
  const rankCountries = useCallback((sourceRows: DataRow[], metric: Metric, dimension: GeoDimension) => {
    const map = new Map<string, RankedItem>();
    sourceRows.forEach((row) => {
      const code = countryCodeFromRow(row, dimension);
      const key = countryKeyFromRow(row, dimension);
      const label = countryLabelFromRow(row, dimension);
      const existing = map.get(key) ?? { key, code: code || undefined, label, value: 0 };
      existing.value += metricValue(row, metric); map.set(key, existing);
    });
    return [...map.values()].filter((item) => item.value > 0).sort((a, b) => b.value - a.value);
  }, []);
  const productRanking = useCallback((sourceRows: DataRow[], metric: Metric) => {
    const map = new Map<string, RankedItem>();
    sourceRows.forEach((row) => {
      const code = commodityCodeFromRow(row);
      const hs4 = code.slice(0, 4);
      let key = code, label = `Код товара ${code}`, shownCode = code;
      if (productLevel === "group") { key = hs4ToGroup[hs4] ?? "Без группы"; label = key; shownCode = ""; }
      if (productLevel === "subgroup") { key = hs4ToSubgroup[hs4] ?? "Без подгруппы"; label = key; shownCode = ""; }
      if (productLevel === "hs4") { key = hs4; label = reference.hs4.find((item) => item.code === hs4)?.name ?? label; shownCode = hs4; }
      if (productLevel === "hs6") label = reference.hs6.find((item) => item.code === code)?.name ?? label;
      const existing = map.get(key) ?? { key, code: shownCode, label, value: 0, memberKeys: [key] };
      existing.value += metricValue(row, metric); map.set(key, existing);
    });
    return [...map.values()].filter((item) => item.value > 0 && item.label !== "TOTAL").sort((a, b) => b.value - a.value);
  }, [productLevel, hs4ToGroup, hs4ToSubgroup]);
  const geoUsd = useMemo(() => rankCountries(rowsForGeo, "usd", geoDimension), [rowsForGeo, geoDimension, rankCountries]);
  const geoTons = useMemo(() => rankCountries(rowsForGeo, "tons", geoDimension), [rowsForGeo, geoDimension, rankCountries]);
  const productUsd = useMemo(() => productRanking(rowsForProducts, "usd"), [rowsForProducts, productRanking]);
  const productTons = useMemo(() => productRanking(rowsForProducts, "tons"), [rowsForProducts, productRanking]);
  const selectedGeoKey = geoFilter?.dimension === geoDimension ? geoFilter.code : undefined;
  const selectedProductKeys = productFilter?.level === productLevel ? productFilter.keys : [];
  const toggleGeoFilter = (item: RankedItem) => setGeoFilter((current) => current?.dimension === geoDimension && current.code === item.key ? null : { dimension: geoDimension, code: item.key, label: item.label });
  const toggleProductFilter = (item: RankedItem) => { const keys = item.memberKeys ?? [item.key]; setProductFilter((current) => current?.level === productLevel && current.keys.join("|") === keys.join("|") ? null : { level: productLevel, keys, label: item.label }); };

  return <main>
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Icon name="globe" size={22}/></span><div><b>Международная торговля</b><span>аналитический контур</span></div></div>
      <div className="top-status"><span className="status-dot"/> UN Comtrade API <i/> Товары <i/> HS</div>
    </header>

    <div className="page-shell">
      <section className="hero">
        <div><p className="eyebrow">Конструктор API-запросов</p><h1>UN Comtrade</h1><p>Соберите запрос к базе международной торговли товарами — с русскими справочниками стран, регионов и кодов ТН ВЭД.</p></div>
        <div className="hero-stats"><div><b>{reference.meta.countries}</b><span>стран и территорий</span></div><div><b>{reference.meta.hs4.toLocaleString("ru-RU")}</b><span>групп HS4</span></div><div><b>{reference.meta.hs6.toLocaleString("ru-RU")}</b><span>позиций HS6</span></div></div>
      </section>

      <nav className="pill-nav"><a href="#parameters" className="active">Параметры</a><a href="#request">Состав запроса</a><a href="#result">Аналитика</a><span>Лимит одной части: {LIMIT.toLocaleString("ru-RU")} строк</span></nav>

      <div className="dashboard-grid">
        <section className="builder-column" id="parameters">
          <article className="panel">
            <div className="panel-head"><span className="step-number">1</span><div><h2>Период и направление</h2><p>Годовые или помесячные данные по потокам импорта и экспорта.</p></div><Icon name="calendar"/></div>
            <div className="segmented"><button type="button" className={cx(freq === "A" && "active")} onClick={() => setFreq("A")}>Годовые данные</button><button type="button" className={cx(freq === "M" && "active")} onClick={() => setFreq("M")}>Помесячные данные</button></div>
            {freq === "M" && <div className="period-mode-row"><span>Способ выбора месяцев</span><div className="segmented"><button type="button" className={monthlyPeriodMode === "range" ? "active" : ""} onClick={() => setMonthlyPeriodMode("range")}>Диапазон</button><button type="button" className={monthlyPeriodMode === "custom" ? "active" : ""} onClick={() => setMonthlyPeriodMode("custom")}>Конкретные месяцы</button></div></div>}
            {freq === "M" && monthlyPeriodMode === "custom" ? <>
              <MonthPeriodPicker values={selectedMonthlyPeriods} onChange={setSelectedMonthlyPeriods}/>
              <div className="field-grid one flow-only"><Field label="Направление торговли"><select value={flowCode} onChange={(e) => setFlowCode(e.target.value)}><option value="M,X">Импорт и экспорт</option><option value="M">Импорт</option><option value="X">Экспорт</option></select></Field></div>
            </> : <div className="field-grid three">
              {freq === "A" ? <><Field label="Начальный год"><input type="number" min="1962" max={currentYear} value={yearFrom} onChange={(e) => setYearFrom(Number(e.target.value))}/></Field><Field label="Конечный год"><input type="number" min="1962" max={currentYear} value={yearTo} onChange={(e) => setYearTo(Number(e.target.value))}/></Field></> : <><Field label="Начальный месяц"><input type="month" min="1962-01" max={`${currentYear}-12`} value={monthFrom} onInput={(e) => setMonthFrom(e.currentTarget.value)} onChange={(e) => setMonthFrom(e.target.value)}/></Field><Field label="Конечный месяц"><input type="month" min="1962-01" max={`${currentYear}-12`} value={monthTo} onInput={(e) => setMonthTo(e.currentTarget.value)} onChange={(e) => setMonthTo(e.target.value)}/></Field></>}
              <Field label="Направление торговли"><select value={flowCode} onChange={(e) => setFlowCode(e.target.value)}><option value="M,X">Импорт и экспорт</option><option value="M">Импорт</option><option value="X">Экспорт</option></select></Field>
            </div>}
            <div className="inline-summary"><Icon name="calendar" size={16}/><span>В запрос войдёт периодов: <b>{periods.length}</b></span><em>{periods.length > PERIOD_BATCH ? `Будут разделены на ${Math.ceil(periods.length / PERIOD_BATCH)} последовательных пакета по периодам` : freq === "M" && monthlyPeriodMode === "custom" ? "В запрос войдут только отмеченные месяцы" : "Один пакет по периодам"}</em></div>
          </article>

          <article className="panel">
            <div className="panel-head"><span className="step-number">2</span><div><h2>География</h2><p>Страна и регион взаимоисключающие внутри каждой стороны торговли.</p></div><Icon name="pin"/></div>
            <div className="geo-pair">
              <div className="geo-card"><div className="geo-title"><span>1</span><div><b>Страна 1 / Регион 1</b><small>Reporter — кто сообщает данные</small></div></div>
                <Field label="Страна 1"><SearchSelect value={country1} choices={countryChoices} placeholder="Выберите страну-reporter" onChange={(value) => { setCountry1(value); if (value) setRegion1(""); }}/></Field>
                <div className="or-divider"><span>или</span></div>
                <Field label="Регион 1"><SearchSelect value={region1} choices={regionChoices} placeholder="Выберите регион" onChange={(value) => { setRegion1(value); if (value) setCountry1(""); }}/></Field>
                <div className="availability"><div><span>Последние доступные периоды</span>{country1 && country1 !== ALL_COUNTRIES && <button type="button" aria-label="Обновить"><Icon name="refresh" size={14}/></button>}</div>{region1 || country1 === ALL_COUNTRIES ? <p>Доступность показывается для отдельной Страны 1.</p> : availabilityState === "loading" ? <p>Проверяем UN Comtrade…</p> : availabilityState === "error" ? <p className="error-text">Не удалось получить справку.</p> : availability.length ? <div className="period-chips">{availability.map((period) => <span key={period}>{freq === "M" ? `${period.slice(0,4)}.${period.slice(4,6)}` : period}</span>)}</div> : <p>{country1 ? "Доступные периоды не найдены." : "Появятся после выбора Страны 1."}</p>}</div>
              </div>
              <div className="geo-card"><div className="geo-title secondary"><span>2</span><div><b>Страна 2 / Регион 2</b><small>Partner — торговый партнёр</small></div></div>
                <Field label="Страна 2"><SearchSelect value={country2} choices={partnerChoices} placeholder="Выберите страну-partner" onChange={(value) => { setCountry2(value || "0"); if (value) setRegion2(""); }}/></Field>
                <div className="or-divider"><span>или</span></div>
                <Field label="Регион 2"><SearchSelect value={region2} choices={regionChoices} placeholder="Выберите регион" onChange={(value) => { setRegion2(value); if (value) setCountry2(""); }}/></Field>
                <div className="region-note"><Icon name="globe" size={16}/><span>{region2 ? `${partnerCodes.length} кодов стран будут переданы как partnerCode` : country2 === ALL_COUNTRIES ? "Все партнёры будут возвращены отдельными строками" : `Партнёр: ${country2Name ?? "не выбран"}`}</span></div>
              </div>
            </div>
          </article>

          <article className="panel">
            <div className="panel-head"><span className="step-number">3</span><div><h2>Товары и грузы</h2><p>Фильтры последовательно сужают выбор. Приоритет результата — выбранные коды HS6.</p></div><Icon name="box"/></div>
            <Field label="Охват товаров" hint="AG4 и AG6 возвращают все товары с детализацией на выбранном уровне">
              <div className="segmented product-mode">
                {([['TOTAL', 'Все товары · TOTAL'], ['AG4', 'Все HS4 · AG4'], ['AG6', 'Все HS6 · AG6'], ['CUSTOM', 'Выбрать товары']] as const).map(([value, label]) => <button type="button" key={value} className={productMode === value ? "active" : ""} onClick={() => { setProductMode(value); if (value !== "CUSTOM") { setCargoGroup(""); setCargoSubgroup(""); setSelectedHs4([]); setSelectedHs6([]); } }}>{label}</button>)}
              </div>
            </Field>
            <div className="field-grid two cargo-fields">
              <Field label="Группа груза" hint={cargoGroup ? `Автоматически: ${(reference.groupToHs4[cargoGroup] ?? []).length} кодов HS4` : "Список учитывает выбранные HS4/HS6"}><select value={cargoGroup} onChange={(e) => { const group = e.target.value; setProductMode("CUSTOM"); setCargoGroup(group); if (cargoSubgroup && subgroupToGroup[cargoSubgroup] !== group) setCargoSubgroup(""); }}><option value="">Все группы грузов</option>{groupOptions.map((item) => <option key={item}>{item}</option>)}</select></Field>
              <Field label="Подгруппа груза" hint={cargoSubgroup ? `Автоматически: ${(reference.subgroupToHs4[cargoSubgroup] ?? []).length} кодов HS4` : "Список учитывает группу груза и выбранные товары"}><select value={cargoSubgroup} onChange={(e) => { const subgroup = e.target.value; setProductMode("CUSTOM"); setCargoSubgroup(subgroup); if (subgroup) setCargoGroup(subgroupToGroup[subgroup] ?? ""); }}><option value="">Все подгруппы</option>{subgroupOptions.map((item) => <option key={item}>{item}</option>)}</select></Field>
            </div>
            {(cargoGroup || cargoSubgroup) && !selectedHs4.length && !selectedHs6.length && <div className="code-level-choice"><div><b>Уровень кодов для запроса</b><span>Применяется, когда выбрана только группа или подгруппа груза</span></div><div className="segmented"><button type="button" className={cargoCodeLevel === "hs4" ? "active" : ""} onClick={() => setCargoCodeLevel("hs4")}>4 знака · HS4</button><button type="button" className={cargoCodeLevel === "hs6" ? "active" : ""} onClick={() => setCargoCodeLevel("hs6")}>6 знаков · HS6</button></div></div>}
            <div className="field-grid two">
              <Field label="Группа товаров — 4 знака" hint={`${hs4Choices.length.toLocaleString("ru-RU")} доступных позиций · поиск по коду и описанию`}><MultiSearch values={selectedHs4} onChange={(values) => { setProductMode("CUSTOM"); setSelectedHs4(values); setSelectedHs6([]); }} choices={hs4Choices} placeholder="Выберите коды HS4"/></Field>
              <Field label="Группа товаров — 6 знаков" hint={allowedHs4.length ? `Показаны позиции внутри ${allowedHs4.length} кодов HS4` : "Поиск по всей базе HS6"}><MultiSearch values={selectedHs6} onChange={(values) => { setProductMode("CUSTOM"); setSelectedHs6(values); }} choices={hs6Choices} placeholder="Выберите коды HS6"/></Field>
            </div>
            <label className="aggregate-option"><input type="checkbox" checked={aggregateByCmdCode} onChange={(e) => setAggregateByCmdCode(e.target.checked)}/><span><b>Агрегировать по кодам товаров</b><small>Добавить в запрос <code>aggregateBy=cmdCode</code></small></span></label>
            <div className={cx("code-result", cmdCodes.length === 0 && "error-box")}><div><Icon name="code"/><span>Итоговый параметр <b>cmdCode</b></span><strong>{cmdCodes.length ? `${cmdCodes.length.toLocaleString("ru-RU")} кодов` : "Пустой перечень"}</strong></div><p>{cmdCodes.slice(0, 14).join(", ")}{cmdCodes.length > 14 ? ` и ещё ${cmdCodes.length - 14}` : ""}</p></div>
          </article>

          <article className="panel api-panel">
            <div className="panel-head"><span className="step-number">4</span><div><h2>Доступ к API</h2><p>Без ключа доступен публичный preview. Ключ используется только во время текущего запроса.</p></div><Icon name="key"/></div>
            <Field label="API-ключ UN Comtrade" hint="Не сохраняется в справочниках и не включается в копируемый URL"><input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Вставьте subscription key — необязательно" autoComplete="off"/></Field>
          </article>
        </section>

        <aside className="request-panel" id="request">
          <div className="request-head"><div><span>Состав запроса</span><h2>{apiKey ? "Полный API" : "Public preview"}</h2></div><span className={cx("ready-badge", isValid && "ready")}>{isValid ? "Готов" : "Заполните поля"}</span></div>
          <dl className="request-list">
            <div><dt>Частота</dt><dd>{freq === "A" ? "Годовые · A" : "Помесячные · M"}</dd></div>
            <div><dt>Период</dt><dd>{periodSummary}<small>{freq === "M" && monthlyPeriodMode === "custom" ? periods.join(", ") || "—" : ""}</small></dd></div>
            <div><dt>Reporter</dt><dd>{region1 || country1Name || "Не выбран"}<small>{country1 === ALL_COUNTRIES ? "параметр reporterCode не ограничен" : reporterCodes.length ? reporterCodes.join(", ") : "—"}</small></dd></div>
            <div><dt>Partner</dt><dd>{region2 || country2Name || "Мир"}<small>{country2 === ALL_COUNTRIES ? "параметр partnerCode не ограничен" : partnerCodes.length > 8 ? `${partnerCodes.slice(0, 8).join(", ")}…` : partnerCodes.join(", ")}</small></dd></div>
            <div><dt>Товары</dt><dd>{cmdCodes[0] === "TOTAL" ? "Все товары · TOTAL" : cmdCodes[0] === "AG4" ? "Все товары на уровне HS4 · AG4" : cmdCodes[0] === "AG6" ? "Все товары на уровне HS6 · AG6" : selectedHs6.length ? "Выбранные коды HS6" : "Выбранные коды HS4"}<small>{cmdCodes.length.toLocaleString("ru-RU")} кодов · стартовых пакетов: {requestParams.length}{aggregateByCmdCode ? " · aggregateBy=cmdCode" : ""}</small></dd></div>
            <div><dt>Поток</dt><dd>{flowCode === "M,X" ? "Импорт и экспорт" : flowCode === "M" ? "Импорт" : "Экспорт"}<small>{flowCode}</small></dd></div>
          </dl>
          <div className="limit-box"><div><span>{countState === "loading" ? "Строим очередь" : "Последовательная очередь"}</span><b>{countSignature === signature && countState === "loading" ? `${queueProgress.completed} / ${queueProgress.total}` : effectiveCount === null ? "Не проверено" : `${effectiveCount.toLocaleString("ru-RU")} строк`}</b></div><div className="limit-track"><span style={{ width: `${countState === "loading" ? queueProgress.total ? queueProgress.completed / queueProgress.total * 100 : 0 : Math.min(100, (effectiveMaxBatchCount / LIMIT) * 100)}%` }}/></div><small>{queueReady ? `${effectiveQueue.length.toLocaleString("ru-RU")} запросов · крупнейшая часть ${effectiveMaxBatchCount.toLocaleString("ru-RU")} из ${LIMIT.toLocaleString("ru-RU")}` : `Лимит одной части: ${LIMIT.toLocaleString("ru-RU")} строк · до ${PERIOD_BATCH} периодов`}</small></div>
          {queueProgress.phase === "loading" && <div className="queue-progress"><span>Выполнено запросов: {queueProgress.completed} из {queueProgress.total}</span><b>Получено строк: {queueProgress.rows.toLocaleString("ru-RU")}</b><i><em style={{ width: `${queueProgress.total ? queueProgress.completed / queueProgress.total * 100 : 0}%` }}/></i></div>}
          {effectiveMessage && <div className="notice"><Icon name="gauge" size={17}/><span>{effectiveMessage}</span></div>}
          <div className="api-url"><div><span>API URL {directUrls.length > 1 && `· пакет 1 из ${directUrls.length}`}</span><button type="button" onClick={copyUrls}><Icon name={copied ? "check" : "copy"} size={15}/>{copied ? "Скопировано" : "Копировать все"}</button></div><code>{directUrls[0] || "Сформируется после заполнения параметров"}</code></div>
          <div className="request-actions"><button type="button" className="btn secondary" onClick={checkCount} disabled={!isValid || countState === "loading" || dataState === "loading"}><Icon name="gauge"/>{countState === "loading" ? "Строим очередь…" : "Проверить и разбить"}</button><button type="button" className="btn primary" onClick={runQuery} disabled={!isValid || dataState === "loading" || !queueReady}><Icon name="play"/>{dataState === "loading" ? `${queueProgress.completed} / ${queueProgress.total}` : "Выполнить очередь"}</button></div>
          <p className="request-footnote">Запросы выполняются строго по одному. Сначала система делит периоды и товары на допустимые пакеты, затем при необходимости — потоки, страны и коды. Ответы объединяются локально.</p>
        </aside>
      </div>

      <section className="panel result-panel" id="result">
        <div className="result-head"><div><p className="eyebrow">Аналитика UN Comtrade</p><h2>{effectiveRows.length ? `${effectiveRows.length.toLocaleString("ru-RU")} строк визуализировано` : "Визуализация результатов"}</h2></div><button type="button" className="btn secondary" onClick={downloadCsv} disabled={!effectiveRows.length}><Icon name="download"/>Скачать исходные данные</button></div>
        {effectiveRows.length ? <div className="analytics">
          {(activeFlow || geoFilter || productFilter) && <div className="active-filters"><span>Активные фильтры:</span>{activeFlow && <button type="button" onClick={() => setActiveFlow(null)}>{FLOW_LABELS[activeFlow]} ×</button>}{geoFilter && <button type="button" onClick={() => setGeoFilter(null)}>{geoFilter.dimension === "reporter" ? "Репортер" : "Партнёр"}: {geoFilter.label} ×</button>}{productFilter && <button type="button" onClick={() => setProductFilter(null)}>{productFilter.label} ×</button>}<button type="button" className="clear-all" onClick={() => { setActiveFlow(null); setGeoFilter(null); setProductFilter(null); }}>Сбросить все</button></div>}
          <section className="analytics-section"><div className="analytics-title"><div><span>01</span><div><h3>Динамика торговли</h3><p>Экспорт и импорт показаны отдельно; прирост — только для последнего периода</p></div></div></div>
            {dynamicsUsd.some((item) => item.points.length > 1) ? <div className="chart-grid"><article className="chart-card"><h4>Стоимость, доллары США</h4><LineChart series={dynamicsUsd} metric="usd" activeFlow={activeFlow} onSelect={(flow, year) => { setActiveFlow((current) => current === flow ? null : flow); if (year) setStructureYear(year); }}/></article><article className="chart-card"><h4>Физический объём, тонны</h4><LineChart series={dynamicsTons} metric="tons" activeFlow={activeFlow} onSelect={(flow, year) => { setActiveFlow((current) => current === flow ? null : flow); if (year) setStructureYear(year); }}/></article></div> : <div className="viz-note">Для отображения динамики выберите более одного годового периода либо месяцы как минимум за два года.</div>}
          </section>
          <section className="analytics-section"><div className="analytics-title structure-title"><div><span>02</span><div><h3>Географическая структура</h3><p>Рейтинг по {geoDimension === "partner" ? "странам-партнёрам" : "странам-репортерам"} · первые 15 позиций</p></div></div><div className="structure-controls"><div className="level-switch">{([['reporter','Репортеры'],['partner','Партнёры']] as const).map(([value,label]) => <button type="button" key={value} className={geoDimension === value ? "active" : ""} onClick={() => setGeoDimension(value)}>{label}</button>)}</div><div className="year-switch" aria-label="Год географической структуры">{availableYears.map((year) => <button type="button" key={year} className={effectiveStructureYear === year ? "active" : ""} onClick={() => setStructureYear(year)}>{year}</button>)}</div></div></div>
            <div className="chart-grid"><article className="chart-card"><h4>Стоимость, доллары США · {effectiveStructureYear}</h4>{geoUsd.length > 1 ? <Ranking items={geoUsd} metric="usd" selectedKey={selectedGeoKey} onSelect={toggleGeoFilter}/> : <div className="viz-note">Для рейтинга запрос должен содержать детализацию по выбранной стороне торговли.</div>}</article><article className="chart-card"><h4>Физический объём, тонны · {effectiveStructureYear}</h4>{geoTons.length > 1 ? <Ranking items={geoTons} metric="tons" selectedKey={selectedGeoKey} onSelect={toggleGeoFilter}/> : <div className="viz-note">В полученных данных недостаточно стран с ненулевым весом.</div>}</article></div>
          </section>
          <section className="analytics-section"><div className="analytics-title product-title"><div><span>03</span><div><h3>Товарная структура</h3><p>Кольцевая диаграмма; общий объём указан в центре</p></div></div><div className="structure-controls"><div className="level-switch">{([['group','Группа груза'],['subgroup','Подгруппа'],['hs4','HS4'],['hs6','HS6']] as const).map(([value,label]) => <button type="button" key={value} className={productLevel === value ? "active" : ""} onClick={() => { setProductLevel(value); setProductFilter(null); }}>{label}</button>)}</div><div className="year-switch" aria-label="Год товарной структуры">{availableYears.map((year) => <button type="button" key={year} className={effectiveStructureYear === year ? "active" : ""} onClick={() => setStructureYear(year)}>{year}</button>)}</div></div></div>
            {(productLevel === "hs6" && !effectiveRows.some((row) => Number(row.aggrLevel) === 6 || String(row.cmdCode ?? "").replace(/\D/g, "").length >= 6)) ? <div className="viz-note">Для детализации HS6 выполните запрос в режиме «Все HS6 · AG6», выберите шестизначные коды либо выберите группу груза с уровнем «6 знаков».</div> : productUsd.length > 1 ? <div className="chart-grid"><article className="chart-card"><h4>Стоимость, доллары США · {effectiveStructureYear}</h4><DonutChart items={productUsd} metric="usd" selectedKeys={selectedProductKeys} onSelect={toggleProductFilter}/></article><article className="chart-card"><h4>Физический объём, тонны · {effectiveStructureYear}</h4><DonutChart items={productTons} metric="tons" selectedKeys={selectedProductKeys} onSelect={toggleProductFilter}/></article></div> : <div className="viz-note">Для товарной структуры запрос должен возвращать несколько товарных кодов. Используйте AG4, AG6 или ручной выбор кодов.</div>}
          </section>
        </div> : <div className="empty-result"><span><Icon name={dataState === "loading" ? "refresh" : "gauge"} size={26}/></span><h3>{dataState === "loading" ? `Выполняется последовательная очередь: ${queueProgress.completed} из ${queueProgress.total}` : "Здесь появится аналитический дашборд"}</h3><p>{dataState === "loading" ? `Получено и объединено строк: ${queueProgress.rows.toLocaleString("ru-RU")}` : "Заполните параметры, проверьте объём и выполните запрос."}</p></div>}
      </section>

      <footer><div>UN Comtrade Query Builder <span>·</span> справочники на русском языке</div><div><a href="https://uncomtrade.org/docs/un-comtrade-api/" target="_blank" rel="noreferrer">Документация API</a><a href="https://comtradeplus.un.org/" target="_blank" rel="noreferrer">UN Comtrade</a></div></footer>
    </div>
  </main>;
}

const COMTRADE_PROXY = process.env.NEXT_PUBLIC_COMTRADE_PROXY_URL?.trim() ?? "";
const PROXY_TIMEOUT_MS = 300_000;

async function fetchComtrade(body: {
  mode: "availability" | "count" | "data";
  freq: "A" | "M";
  params: Record<string, string>;
  subscriptionKey?: string;
}) {
  if (!COMTRADE_PROXY) {
    return new Response(JSON.stringify({
      error: "Не задан адрес прокси UN Comtrade. Укажите переменную GitHub NEXT_PUBLIC_COMTRADE_PROXY_URL по инструкции README.",
    }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  try {
    return await fetch(COMTRADE_PROXY, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    return new Response(JSON.stringify({
      error: timedOut
        ? "Прокси не ответил за 5 минут. Проверьте состояние приложения Timeweb и его доступность без VPN."
        : `Не удалось подключиться к прокси: ${error instanceof Error ? error.message : "ошибка сети"}`,
    }), {
      status: timedOut ? 524 : 502,
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    window.clearTimeout(timeout);
  }
}
