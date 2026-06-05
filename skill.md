---
name: for-rarar-only
description: TailAdmin-style premium UI design system for the Globe web app. Cards always in horizontal rows, white rounded-2xl cards with shadow-sm, clean typography, dark mode support.
---

# Globe Web App — Frontend Design System

Premium UI reference modeled after TailAdmin. All components use Tailwind CSS with consistent tokens.
Dark mode supported via `dark:` variants throughout.

---

## Design Tokens

```
Font:        font-['Geist',_'DM_Sans',_sans-serif]
Radius:      rounded-2xl (cards)  rounded-xl (inner)  rounded-lg (chips)  rounded-full (badges)
Shadow:      shadow-sm (resting)  shadow-md (hover)  shadow-xl (modals/drawers)
Border:      border border-gray-100 dark:border-zinc-700/60
Background:  bg-white dark:bg-zinc-900
Surface:     bg-gray-50/60 dark:bg-zinc-800/60
Text:        text-gray-900 dark:text-white (primary)
             text-gray-500 dark:text-gray-400 (muted)
             text-gray-400 dark:text-gray-500 (faint)
Accent:      text-violet-600  bg-violet-600  (primary action)
```

---

## 1. STAT CARD (Compact Metric)

Use for: Unique Visitors, Total Pageviews, Bounce Rate, Visit Duration

```tsx
// Layout: 4-column grid
<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
  <div
    className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100
                  dark:border-zinc-700/60 shadow-sm p-5 flex flex-col gap-3
                  hover:shadow-md transition-shadow"
  >
    {/* Label */}
    <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
      Unique Visitors
    </p>

    {/* Value + Trend row */}
    <div className="flex items-end justify-between gap-2">
      <p className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">
        24.7K
      </p>

      {/* Trend badge — green for positive */}
      <span
        className="inline-flex items-center gap-1 text-xs font-semibold
                       text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30
                       dark:text-emerald-400 px-2 py-1 rounded-full"
      >
        <svg
          className="w-3 h-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25"
          />
        </svg>
        +20%
      </span>
    </div>

    {/* Comparison label */}
    <p className="text-xs text-gray-400 dark:text-gray-500">Vs last month</p>
  </div>

  {/* Negative trend — red */}
  <div
    className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100
                  dark:border-zinc-700/60 shadow-sm p-5 flex flex-col gap-3
                  hover:shadow-md transition-shadow"
  >
    <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
      Bounce Rate
    </p>
    <div className="flex items-end justify-between gap-2">
      <p className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">
        54%
      </p>
      <span
        className="inline-flex items-center gap-1 text-xs font-semibold
                       text-rose-600 bg-rose-50 dark:bg-rose-900/30
                       dark:text-rose-400 px-2 py-1 rounded-full"
      >
        <svg
          className="w-3 h-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 4.5l-15 15m0 0h11.25M4.5 19.5V8.25"
          />
        </svg>
        -1.59%
      </span>
    </div>
    <p className="text-xs text-gray-400 dark:text-gray-500">Vs last month</p>
  </div>
</div>
```

### Stat Card with Icon Box (alt style)

```tsx
<div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100
                dark:border-zinc-700/60 shadow-sm p-5 flex items-start gap-4
                hover:shadow-md transition-shadow">

  {/* Icon box */}
  <div className="flex h-12 w-12 items-center justify-center rounded-xl
                  bg-gray-100 dark:bg-zinc-800 shrink-0">
    <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" .../>
  </div>

  <div className="flex-1 min-w-0">
    <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Avg. Client Rating</p>
    <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1 tracking-tight">7.8/10</p>
    <span className="text-xs font-semibold text-emerald-600">+20% Vs last month</span>
  </div>
</div>
```

---

## 2. LARGE CARD (Chart + Header + Tabs)

Use for: Analytics, Impression & Data Traffic, any chart widget

```tsx
<div
  className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100
                dark:border-zinc-700/60 shadow-sm"
>
  {/* Card Header */}
  <div
    className="flex items-start justify-between px-6 py-5 border-b
                  border-gray-100 dark:border-zinc-700/60"
  >
    <div>
      <h3 className="text-base font-bold text-gray-900 dark:text-white">
        Analytics
      </h3>
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
        Visitor analytics of last 30 days
      </p>
    </div>

    {/* Tab filter */}
    <div
      className="flex items-center gap-1 bg-gray-100 dark:bg-zinc-800
                    rounded-xl p-1"
    >
      {["12 months", "30 days", "7 days", "24 hours"].map((t) => (
        <button
          key={t}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
            active === t
              ? "bg-white dark:bg-zinc-700 text-gray-900 dark:text-white shadow-sm"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-700"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  </div>

  {/* Chart area — swap with Recharts / Chart.js */}
  <div className="px-6 py-5 h-64">
    {/* <BarChart /> or <AreaChart /> here */}
  </div>
</div>
```

### Large Card with Three-Dot Menu + Total

```tsx
<div
  className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100
                dark:border-zinc-700/60 shadow-sm"
>
  <div
    className="flex items-start justify-between px-6 py-5 border-b
                  border-gray-100 dark:border-zinc-700/60"
  >
    <div>
      <h3 className="text-base font-bold text-gray-900 dark:text-white">
        Impression & Data Traffic
      </h3>
      <p className="text-xs text-gray-400 mt-0.5">Jun 1, 2024 – Dec 1, 2025</p>
    </div>
    <div className="flex items-start gap-4">
      <div className="text-right">
        <p className="text-xl font-bold text-gray-900 dark:text-white">
          $9,758.00
        </p>
        <span className="text-xs font-semibold text-emerald-600">+7.96%</span>
        <p className="text-[10px] text-gray-400 mt-0.5">Total Revenue</p>
      </div>
      {/* Three-dot menu */}
      <button
        className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800
                         text-gray-400 hover:text-gray-600 transition-colors"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
        </svg>
      </button>
    </div>
  </div>

  <div className="p-6 h-64">{/* <AreaChart /> */}</div>
</div>
```

---

## 3. ACTIVITY / LOG CARD (Timeline Chain)

Use for: Invoice activities, delivery logs, teardown events, audit trail

```tsx
<div
  className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100
                dark:border-zinc-700/60 shadow-sm p-6"
>
  {/* Card header */}
  <div className="flex items-center justify-between mb-5">
    <h3 className="text-base font-bold text-gray-900 dark:text-white">
      Activities
    </h3>
    <button
      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800
                       text-gray-400 transition-colors"
    >
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
      </svg>
    </button>
  </div>

  {/* Timeline list */}
  <div className="space-y-0">
    {activities.map((item, i) => (
      <div key={item.id} className="relative flex gap-4">
        {/* Vertical chain line */}
        {i < activities.length - 1 && (
          <div
            className="absolute left-5 top-12 bottom-0 w-px bg-gray-100
                          dark:bg-zinc-700/60"
          />
        )}

        {/* Avatar */}
        <div className="relative shrink-0 z-10">
          <img
            src={item.avatar}
            alt={item.name}
            className="h-10 w-10 rounded-full object-cover ring-2
                       ring-white dark:ring-zinc-900"
          />
          {/* Event type dot */}
          <span
            className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center
                           justify-center rounded-full bg-emerald-500 ring-2
                           ring-white dark:ring-zinc-900"
          >
            <svg
              className="w-2.5 h-2.5 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4v16m8-8H4"
              />
            </svg>
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 pb-6">
          {/* Event type badge */}
          <span
            className="inline-flex items-center gap-1 text-[10px] font-bold
                           text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30
                           rounded-full px-2 py-0.5 mb-1"
          >
            <i className="bx bx-flag text-[10px]" />
            New invoice
          </span>

          {/* Main text */}
          <p className="text-sm text-gray-700 dark:text-gray-300">
            <span className="font-bold text-gray-900 dark:text-white">
              {item.name}
            </span>{" "}
            created invoice{" "}
            <span
              className="font-mono text-xs font-semibold text-violet-600
                             dark:text-violet-400"
            >
              {item.invoiceId}
            </span>
          </p>

          {/* Timestamp */}
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
            {item.time}
          </p>
        </div>
      </div>
    ))}
  </div>
</div>
```

### Event type badge variants

```tsx
// New invoice — green
<span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 rounded-full px-2 py-0.5">
  New invoice
</span>

// Status change — blue
<span className="text-[10px] font-bold text-blue-600 bg-blue-50 rounded-full px-2 py-0.5">
  Status update
</span>

// Warning / failed — red
<span className="text-[10px] font-bold text-rose-600 bg-rose-50 rounded-full px-2 py-0.5">
  Failed
</span>

// Delivery — violet
<span className="text-[10px] font-bold text-violet-600 bg-violet-50 rounded-full px-2 py-0.5">
  Delivery
</span>

// Approved — amber
<span className="text-[10px] font-bold text-amber-600 bg-amber-50 rounded-full px-2 py-0.5">
  Approved
</span>
```

---

## 4. TOP CHANNELS / PAGES TABLE CARD

Use for: Source analytics, page rankings, node traffic

```tsx
<div
  className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100
                dark:border-zinc-700/60 shadow-sm"
>
  {/* Header */}
  <div
    className="flex items-center justify-between px-6 py-5 border-b
                  border-gray-100 dark:border-zinc-700/60"
  >
    <h3 className="text-base font-bold text-gray-900 dark:text-white">
      Top Channels
    </h3>
    <button
      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800
                       text-gray-400 transition-colors"
    >
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
      </svg>
    </button>
  </div>

  {/* Column labels */}
  <div className="flex items-center justify-between px-6 py-2">
    <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
      Source
    </span>
    <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
      Visitors
    </span>
  </div>

  {/* Rows */}
  <div className="divide-y divide-gray-50 dark:divide-zinc-700/40 px-6">
    {channels.map((ch) => (
      <div
        key={ch.source}
        className="flex items-center justify-between py-3
                      hover:bg-gray-50/60 dark:hover:bg-zinc-800/40 -mx-6 px-6
                      transition-colors"
      >
        <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">
          {ch.source}
        </span>
        <span className="text-sm font-semibold text-gray-900 dark:text-white">
          {ch.visitors}
        </span>
      </div>
    ))}
  </div>

  {/* CTA */}
  <div className="px-6 py-4 border-t border-gray-100 dark:border-zinc-700/60">
    <button
      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl
                       border border-gray-200 dark:border-zinc-600 text-sm font-semibold
                       text-gray-700 dark:text-gray-300 hover:bg-gray-50
                       dark:hover:bg-zinc-800 transition-colors"
    >
      Channels Report
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
        />
      </svg>
    </button>
  </div>
</div>
```

---

## 5. TRAFFIC SOURCE CARD (Progress Bars)

Use for: Platform breakdown, source attribution, device split

```tsx
<div
  className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100
                dark:border-zinc-700/60 shadow-sm p-6"
>
  <div className="flex items-center justify-between mb-5">
    <h3 className="text-base font-bold text-gray-900 dark:text-white">
      Top Traffic Source
    </h3>
    <button
      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800
                       text-gray-400 transition-colors"
    >
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
      </svg>
    </button>
  </div>

  <div className="space-y-4">
    {sources.map((src) => (
      <div key={src.platform}>
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2.5">
            {/* Platform icon (img or svg) */}
            <img
              src={src.icon}
              alt={src.platform}
              className="h-5 w-5 rounded"
            />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {src.platform}
            </span>
          </div>
          <span className="text-sm font-bold text-gray-900 dark:text-white">
            {src.percent}%
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-2 w-full bg-gray-100 dark:bg-zinc-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-violet-500 transition-all duration-700"
            style={{ width: `${src.percent}%` }}
          />
        </div>
      </div>
    ))}
  </div>

  {/* CTA */}
  <button
    className="mt-5 w-full py-2.5 rounded-xl border border-gray-200
                     dark:border-zinc-600 text-sm font-semibold text-gray-700
                     dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-zinc-800
                     transition-colors"
  >
    View All
  </button>
</div>
```

### Progress bar color variants by platform

```tsx
// Google  → bg-blue-500
// YouTube → bg-rose-500
// Facebook → bg-blue-700
// Instagram → bg-pink-500
// Direct → bg-violet-500
// Organic → bg-emerald-500
```

---

## 6. CAMPAIGN TABLE CARD

Use for: Featured campaigns, teardown assignments, delivery queue

```tsx
<div
  className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100
                dark:border-zinc-700/60 shadow-sm"
>
  {/* Header */}
  <div
    className="flex items-center justify-between px-6 py-5 border-b
                  border-gray-100 dark:border-zinc-700/60"
  >
    <h3 className="text-base font-bold text-gray-900 dark:text-white">
      Featured Campaigns
    </h3>
    <button
      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800
                       text-gray-400 transition-colors"
    >
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
      </svg>
    </button>
  </div>

  {/* Column headers */}
  <div className="grid grid-cols-[1fr_2fr_auto] gap-4 px-6 py-2">
    <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
      Creator
    </span>
    <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
      Campaign
    </span>
    <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
      Status
    </span>
  </div>

  {/* Rows */}
  <div className="divide-y divide-gray-50 dark:divide-zinc-700/40">
    {campaigns.map((c) => (
      <div
        key={c.id}
        className="grid grid-cols-[1fr_2fr_auto] items-center gap-4 px-6 py-3
                      hover:bg-gray-50/60 dark:hover:bg-zinc-800/40 transition-colors"
      >
        {/* Creator */}
        <div className="flex items-center gap-2.5 min-w-0">
          <img
            src={c.avatar}
            alt={c.creator}
            className="h-8 w-8 rounded-full object-cover shrink-0"
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
            {c.creator}
          </span>
        </div>

        {/* Campaign */}
        <div className="flex items-center gap-2.5 min-w-0">
          <img
            src={c.campaignIcon}
            alt={c.campaign}
            className="h-7 w-7 rounded-lg object-cover shrink-0"
          />
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
              {c.campaign}
            </p>
            <p className="text-[11px] text-gray-400 truncate">{c.type}</p>
          </div>
        </div>

        {/* Status badge */}
        <StatusBadge status={c.status} />
      </div>
    ))}
  </div>
</div>
```

### Status badge component

```tsx
const STATUS = {
  Success:
    "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400",
  Pending:
    "text-amber-600  bg-amber-50  dark:bg-amber-900/30  dark:text-amber-400",
  Failed:
    "text-rose-600   bg-rose-50   dark:bg-rose-900/30   dark:text-rose-400",
};

function StatusBadge({ status }: { status: keyof typeof STATUS }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full
                      text-xs font-bold whitespace-nowrap ${STATUS[status]}`}
    >
      {status}
    </span>
  );
}
```

---

## 7. TRAFFIC STATS CARD (Today / Week / Month toggle)

Use for: Live stats panel, quick KPI snapshot

```tsx
<div
  className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100
                dark:border-zinc-700/60 shadow-sm p-6"
>
  {/* Header + tabs */}
  <div className="flex items-center justify-between mb-5">
    <h3 className="text-base font-bold text-gray-900 dark:text-white">
      Traffic Stats
    </h3>
    <div className="flex gap-1 bg-gray-100 dark:bg-zinc-800 rounded-xl p-1">
      {["Today", "Week", "Month"].map((t) => (
        <button
          key={t}
          className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
            active === t
              ? "bg-white dark:bg-zinc-700 text-gray-900 dark:text-white shadow-sm"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-700"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  </div>

  {/* Stat rows with sparkline */}
  <div className="space-y-5 divide-y divide-gray-50 dark:divide-zinc-700/40">
    {[
      { label: "New Subscribers", value: "567K", trend: "+3.85%", up: true },
      { label: "Conversion Rate", value: "276K", trend: "-5.39%", up: false },
      { label: "Page Bounce Rate", value: "285", trend: "+12.74%", up: true },
    ].map((stat) => (
      <div
        key={stat.label}
        className="flex items-center justify-between pt-5 first:pt-0"
      >
        <div>
          <p className="text-xs font-medium text-gray-400 dark:text-gray-500 mb-1">
            {stat.label}
          </p>
          <p className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">
            {stat.value}
          </p>
          <p
            className={`text-xs font-semibold mt-0.5 ${
              stat.up ? "text-emerald-600" : "text-rose-600"
            }`}
          >
            {stat.trend} then last Week
          </p>
        </div>

        {/* Sparkline placeholder — swap with recharts Sparkline */}
        <div className="h-10 w-24 flex items-center">
          <svg
            viewBox="0 0 96 40"
            className={`w-full ${stat.up ? "text-emerald-500" : "text-rose-500"}`}
          >
            <polyline
              points="0,35 16,28 32,32 48,18 64,22 80,12 96,16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    ))}
  </div>
</div>
```

---

## 8. ACTIVE USERS CARD (Live indicator)

Use for: Real-time visitor count, live delivery tracking

```tsx
<div
  className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100
                dark:border-zinc-700/60 shadow-sm p-6"
>
  <div className="flex items-center justify-between mb-4">
    <h3 className="text-base font-bold text-gray-900 dark:text-white">
      Active Users
    </h3>
    <button
      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800
                       text-gray-400 transition-colors"
    >
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
      </svg>
    </button>
  </div>

  {/* Live count */}
  <div className="flex items-center gap-2 mb-5">
    {/* Pulsing live dot */}
    <span className="relative flex h-3 w-3">
      <span
        className="animate-ping absolute inline-flex h-full w-full rounded-full
                       bg-rose-400 opacity-75"
      />
      <span className="relative inline-flex h-3 w-3 rounded-full bg-rose-500" />
    </span>
    <p className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">
      475
    </p>
    <p className="text-sm text-gray-400 dark:text-gray-500">Live visitors</p>
  </div>

  {/* Area chart placeholder */}
  <div className="h-24 mb-5">{/* <AreaChart /> */}</div>

  {/* Summary stats row */}
  <div
    className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-100
                  dark:border-zinc-700/60"
  >
    {[
      { label: "Avg. Daily", value: "224" },
      { label: "Avg. Weekly", value: "1.4K" },
      { label: "Avg. Monthly", value: "22.1K" },
    ].map((s) => (
      <div key={s.label} className="text-center">
        <p className="text-lg font-bold text-gray-900 dark:text-white">
          {s.value}
        </p>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
          {s.label}
        </p>
      </div>
    ))}
  </div>
</div>
```

---

## 9. SUMMARY / DETAIL DRAWER

Use for: Receipt detail, delivery detail, teardown log — slides in from the right

```tsx
{/* Backdrop */}
<div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
     onClick={onClose} />

{/* Drawer */}
<div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg
                bg-white dark:bg-zinc-900 shadow-2xl flex flex-col overflow-hidden
                animate-in slide-in-from-right duration-300">

  {/* Drawer header */}
  <div className="flex items-center gap-3 px-5 py-4 border-b
                  border-gray-100 dark:border-zinc-700/60 shrink-0">
    <div className="flex h-9 w-9 items-center justify-center rounded-xl
                    bg-emerald-50 dark:bg-emerald-900/30 shrink-0">
      <svg className="w-4 h-4 text-emerald-600" .../>
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-gray-900 dark:text-white">
          Receipt #42
        </span>
        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold
                         text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30">
          Approved
        </span>
      </div>
      <p className="text-[11px] text-gray-400 mt-0.5">Jun 4, 2026 · 2:45 PM</p>
    </div>
    <button onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-xl
                       border border-gray-200 dark:border-zinc-700 text-gray-400
                       hover:text-gray-700 dark:hover:text-gray-200 transition shrink-0">
      <svg className="w-4 h-4" .../>
    </button>
  </div>

  {/* Drawer body — scrollable */}
  <div className="flex-1 overflow-y-auto p-5 space-y-5">
    {/* content sections here */}
  </div>
</div>
```

---

## 10. EMPTY STATE

```tsx
<div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
  <div className="flex h-16 w-16 items-center justify-center rounded-2xl
                  bg-gray-100 dark:bg-zinc-800">
    <svg className="w-7 h-7 text-gray-300 dark:text-zinc-600" .../>
  </div>
  <div>
    <p className="text-sm font-bold text-gray-500 dark:text-gray-400">
      No records found
    </p>
    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
      Try adjusting your filters
    </p>
  </div>
  <button className="mt-2 px-4 py-2 rounded-xl bg-violet-600 text-white
                     text-sm font-semibold hover:bg-violet-700 transition-colors">
    Reset Filters
  </button>
</div>
```

---

## 11. FILTER PILL ROW

Use anywhere you need status / category filters

```tsx
<div className="flex flex-wrap gap-2">
  {/* "All" pill */}
  <button
    className="rounded-full px-3 py-1.5 text-xs font-bold transition-all
                     bg-gray-900 dark:bg-white text-white dark:text-gray-900"
  >
    All (48)
  </button>

  {/* Status pill */}
  <button
    className="rounded-full px-3 py-1.5 text-xs font-bold transition-all
                     border border-gray-200 dark:border-zinc-600 text-gray-500
                     dark:text-gray-400 hover:border-gray-300 bg-white dark:bg-zinc-800"
  >
    Approved (12)
  </button>
</div>
```

---

## 12. USER / PERSON CARD (inline)

Use inside drawers, log cards, assignment panels

```tsx
<div className="flex items-center gap-3 rounded-2xl border px-4 py-3
                bg-blue-50 dark:bg-blue-950/20 border-blue-200/60
                dark:border-blue-900/40">
  <div className="flex h-10 w-10 items-center justify-center rounded-xl
                  bg-blue-100 dark:bg-blue-900/50 shrink-0">
    <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" .../>
  </div>
  <div className="flex-1 min-w-0">
    <p className="text-[9px] font-black uppercase tracking-widest text-blue-500 mb-0.5">
      Submitted By
    </p>
    <p className="text-sm font-bold text-blue-800 dark:text-blue-300 truncate">
      Mark Tomenio
    </p>
    <div className="flex items-center gap-2 mt-0.5">
      <span className="text-[9px] font-mono font-bold opacity-60 text-blue-600">ID #14</span>
      <span className="text-[8px] font-bold uppercase rounded-full px-1.5 py-0.5
                       bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400">
        admin
      </span>
    </div>
  </div>
</div>
```

### Person card color themes

```
Submitted By → blue-500   / bg-blue-50
Approved By  → emerald-600 / bg-emerald-50
Received By  → violet-600  / bg-violet-50
Driver       → amber-600   / bg-amber-50
Rejected By  → rose-600    / bg-rose-50
```

---

## Layout Grid Patterns

> **RULE: Cards are ALWAYS in a row on desktop. Never single-column on md+ screens.**
> Mobile stacks vertically (`grid-cols-1`), tablet goes 2-col, desktop goes 3 or 4-col.
> This matches TailAdmin's dashboard grid — horizontal rows of cards at all times.

```tsx
// ── Stat cards row (4-across on xl, 2-across on sm) ──────────────────────────
<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
  <StatCard />
  <StatCard />
  <StatCard />
  <StatCard />
</div>

// ── Large chart + sidebar (2/3 + 1/3) ────────────────────────────────────────
<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
  <div className="lg:col-span-2"> {/* AreaChart / BarChart card */} </div>
  <div>                           {/* Traffic Stats or Sources card */} </div>
</div>

// ── Three equal cards in a row ────────────────────────────────────────────────
<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
  <TopChannelsCard />
  <TopPagesCard />
  <ActiveUsersCard />
</div>

// ── Two equal cards in a row ──────────────────────────────────────────────────
<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
  <CampaignTableCard />
  <TrafficSourceCard />
</div>

// ── Full-width single card (table / log) ──────────────────────────────────────
<div className="w-full">
  <ActivityLogCard />
</div>

// ── Full dashboard page assembly (TailAdmin order) ────────────────────────────
<div className="space-y-4 p-6">
  {/* Row 1 — stat pills */}
  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">...</div>

  {/* Row 2 — main chart + side panel */}
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">...</div>

  {/* Row 3 — three small cards */}
  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">...</div>

  {/* Row 4 — two medium cards */}
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">...</div>
</div>
```

---

## Card Anatomy Rules

| Zone          | Class pattern                                                        |
| ------------- | -------------------------------------------------------------------- |
| Card wrapper  | `bg-white rounded-2xl border border-gray-100 shadow-sm`              |
| Card header   | `px-6 py-5 border-b border-gray-100`                                 |
| Card body     | `p-6` or `px-6 py-4`                                                 |
| Card footer   | `px-6 py-4 border-t border-gray-100`                                 |
| Section label | `text-[11px] font-semibold text-gray-400 uppercase tracking-wider`   |
| Primary value | `text-2xl font-bold text-gray-900 tracking-tight`                    |
| Muted text    | `text-xs text-gray-400`                                              |
| Three-dot btn | `p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors` |
| Hover row     | `hover:bg-gray-50/60 transition-colors`                              |
| Divider       | `divide-y divide-gray-50` or `border-t border-gray-100`              |
