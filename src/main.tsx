import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  Map,
  Layers,
  GitMerge,
  ShieldCheck,
  ArrowUpRight,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Search,
  Upload,
  Download,
  X,
  Mountain,
  MapPin,
  Database,
  FlaskConical,
  Check,
  Activity,
  Clock,
  Info,
  FileCheck2,
  Route,
  Plus,
  RefreshCw,
  BookOpen,
  ExternalLink,
  Menu,
  Leaf,
  AlertTriangle,
  Shield,
  CheckCircle2,
} from "lucide-react";
import MapView from "./MapView";
import "./styles.css";
type Any = any;
const empty = { type: "FeatureCollection", features: [] };
const format = (n: number | undefined) =>
  n === undefined ? "—" : n.toLocaleString();
const percent = (n: number) => `${(n * 100).toFixed(1)}%`;
async function api(path: string, body?: Any) {
  const r = await fetch(
    `/api/${path}`,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const d = await r.json();
  if (!r.ok)
    throw new Error(
      typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail || d),
    );
  return d;
}
function download(name: string, data: Any) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
const nav = [
  ["overview", "Overview", LayoutDashboard],
  ["explorer", "Hazard explorer", Map],
  ["harmonize", "Harmonization", GitMerge],
  ["relocation", "Relocation planner", Route],
  ["models", "Model lab", FlaskConical],
  ["sources", "Data sources", Database],
  ["audit", "Audit trail", ShieldCheck],
] as const;
function Badge({
  children,
  tone = "green",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Empty({
  icon: Icon = Layers,
  title,
  text,
  action,
}: {
  icon?: Any;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={27} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function App() {
  const [page, setPage] = useState("overview"),
    [overview, setOverview] = useState<Any>({}),
    [events, setEvents] = useState<Any>(empty),
    [sources, setSources] = useState<Any[]>([]),
    [models, setModels] = useState<Any[]>([]),
    [matches, setMatches] = useState<Any[]>([]),
    [audit, setAudit] = useState<Any>({ entries: [], valid: true }),
    [loading, setLoading] = useState(true),
    [toast, setToast] = useState(""),
    [upload, setUpload] = useState(false),
    [selected, setSelected] = useState<Any>(null),
    [mobile, setMobile] = useState(false),
    [country, setCountry] = useState("India"),
    [size, setSize] = useState("all"),
    [search, setSearch] = useState(""),
    [year, setYear] = useState("all"),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("all"),
    [left, setLeft] = useState(""),
    [right, setRight] = useState(""),
    [review, setReview] = useState<Any>(null),
    [reason, setReason] = useState(""),
    [screen, setScreen] = useState<Any>(null),
    [area, setArea] = useState(45),
    [water, setWater] = useState(135),
    [modelId, setModelId] = useState(""),
    [inputs, setInputs] = useState<Any>({}),
    [prediction, setPrediction] = useState<Any>(null),
    [config, setConfig] = useState<Any>({
      deployment_mode: "local",
      max_upload_mb: 15,
    });
  const hosted = config.deployment_mode === "public";
  async function refresh() {
    const [o, s, m, r, a] = await Promise.all([
      api("overview"),
      api("sources"),
      api("models"),
      api("matches"),
      api("audit"),
    ]);
    setOverview(o);
    setSources(s);
    setModels(m);
    setMatches(r);
    setAudit(a);
  }
  useEffect(() => {
    api("config")
      .then((c) => {
        setConfig(c);
        return refresh();
      })
      .catch((e) => setToast(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    let live = true;
    api(
      `events?country=${country}&size=${size}&year=${year}&q=${encodeURIComponent(search)}`,
    )
      .then((d) => {
        if (live) setEvents(d);
      })
      .catch((e) => {
        if (live) setToast(e.message);
      });
    return () => {
      live = false;
    };
  }, [country, size, year, search]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 6500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const navigate = (p: string) => {
    setPage(p);
    setMobile(false);
    setSelected(null);
  };
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e: Any) {
      setToast(e.message);
    } finally {
      setBusy(false);
    }
  }
  const currentModel = models.find((m) => m.id === modelId) || models[0];
  useEffect(() => {
    if (currentModel) {
      setInputs(
        Object.fromEntries(
          currentModel.inputs.map((f: Any) => [f.name, f.default]),
        ),
      );
      setPrediction(null);
    }
  }, [currentModel?.id]);
  const filteredMatches = matches.filter(
    (m) =>
      tab === "all" ||
      (tab === "pending" ? m.status === "pending" : m.tier === tab),
  );
  const eligibleSources = sources.filter((s) =>
    ["cadastral", "revenue", "survey"].includes(s.kind),
  );
  const report = () =>
    run(async () => {
      const d = await api("overview");
      download("bhoomi-workspace-report.json", {
        generated_at: new Date().toISOString(),
        summary: d,
        model_cards: models,
        source_lineage: sources.map(({ geojson, ...s }) => ({
          ...s,
          feature_count: geojson.features.length,
        })),
        limitations:
          "Historical catalog, local single-user review. No operational hazard forecast or certified title decisions.",
      });
      setToast("Workspace report exported.");
    });
  const eventList = [...events.features].sort((a: Any, b: Any) =>
    b.properties.date.localeCompare(a.properties.date),
  );
  return (
    <div className="app">
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("overview");
          }}
        >
          <div className="brand-icon">
            <Mountain size={27} />
            <Leaf size={13} />
          </div>
          <div>
            Bhoomi<span>Suraksha</span>
          </div>
        </a>
        <div className="workspace">
          <span className="workspace-icon">
            <Layers size={16} />
          </span>
          <div>
            Land intelligence
            <small>
              {hosted
                ? "Isolated browser workspace"
                : "Local research workspace"}
            </small>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              className={page === id ? "selected" : ""}
              onClick={() => navigate(id)}
            >
              <Icon size={18} />
              {label}
              {id === "harmonize" && overview.pending > 0 && (
                <span className="nav-count">{overview.pending}</span>
              )}
              {page === id && <span className="nav-active" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="evidence-note">
            <Shield size={21} />
            <h4>Evidence before action.</h4>
            <p>
              Every source preserved.
              <br />
              Every decision traceable.
            </p>
            <button onClick={() => navigate("audit")}>
              View audit trail <ArrowUpRight size={14} />
            </button>
          </div>
          <div className="profile">
            <div className="avatar">LA</div>
            <div>
              {hosted ? "Workspace analyst" : "Local analyst"}
              <small>{hosted ? "Browser session" : "Single-user pilot"}</small>
            </div>
            <span className="status-dot" />
          </div>
        </div>
      </aside>
      <div className="main">
        <header>
          <div className="breadcrumb">
            <button
              className="mobile-toggle"
              aria-label="Open navigation"
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={20} />
            </button>
            Workspace <ChevronRight size={13} />{" "}
            <strong>{nav.find((n) => n[0] === page)?.[1]}</strong>
          </div>
          <div className="header-right">
            <span className="connection">
              <i />
              {hosted ? "Hosted workspace" : "Local workspace"}
            </span>
            <span className="header-separator" />
            <button
              className="icon-button"
              aria-label="Refresh workspace"
              onClick={() => run(refresh)}
            >
              <RefreshCw size={16} className={busy ? "spin" : ""} />
            </button>
            <div className="avatar small">LA</div>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                BHOOMI SURAKSHA <span>/</span> LAND & RESILIENCE
              </div>
              <h1>
                {
                  (
                    {
                      overview: "Clarity on the ground.",
                      explorer: "See the evidence. Map the risk.",
                      harmonize: "Many records. One clear picture.",
                      relocation: "A better place to begin.",
                      models: "Real data. Measurable intelligence.",
                      sources: "Know where your data comes from.",
                      audit: "Every decision leaves a trail.",
                    } as Any
                  )[page]
                }
              </h1>
              <p>
                {
                  (
                    {
                      overview:
                        "From fragmented records to informed decisions. Your land intelligence, in one place.",
                      explorer:
                        "Explore documented landslide events and their original reporting sources.",
                      harmonize:
                        "Match features, understand disagreements, and review every proposed correction.",
                      relocation:
                        "Screen uploaded sites against hazard polygons, available land, and water capacity.",
                      models:
                        "CPU-trained models with reproducible datasets, honest baselines, and visible limitations.",
                      sources:
                        "Traceable public datasets and your own departmental geospatial layers.",
                      audit:
                        "A persistent, hash-linked history of source imports, analysis, and human review.",
                    } as Any
                  )[page]
                }
              </p>
            </div>
            <div className="heading-actions">
              <button className="button secondary" onClick={report}>
                <Download size={15} />
                Export report
              </button>
              <button
                className="button primary"
                onClick={() => setUpload(true)}
              >
                <Plus size={17} />
                Import layer
              </button>
            </div>
          </div>
          {hosted && (
            <div className="notice">
              <Shield size={18} />
              <div>
                <strong>Your browser, your workspace.</strong> Uploads and
                decisions are separated from other visitors. Access uses this
                browser’s cookie and expires after 7 days. Export work you want
                to keep.
                {config.storage_ephemeral &&
                  " This free host resets uploaded work when the service sleeps, restarts, or redeploys. Download your results before leaving."}
              </div>
            </div>
          )}
          {loading ? (
            <div className="loading">
              <RefreshCw className="spin" />
              Loading your workspace…
            </div>
          ) : (
            <>
              {(page === "overview" || page === "explorer") && (
                <>
                  <div className="stats-grid">
                    <Stat
                      label="Documented events · India"
                      value={format(overview.india_events)}
                      detail="NASA historical catalog"
                      icon={Mountain}
                      color="terracotta"
                    />
                    <Stat
                      label="Global event records"
                      value={format(overview.total_events)}
                      detail={`${overview.period?.start?.slice(0, 4)}–${overview.period?.end?.slice(0, 4)} · observed events`}
                      icon={MapPin}
                    />
                    <Stat
                      label="Sources to harmonize"
                      value={format(overview.sources)}
                      detail={`${format(overview.features)} uploaded features`}
                      icon={Layers}
                    />
                    <Stat
                      label="Trained models"
                      value={format(overview.models)}
                      detail="Real datasets · CPU inference"
                      icon={FlaskConical}
                      color="purple"
                    />
                  </div>
                  <div className="panel map-panel">
                    <div className="panel-header">
                      <div>
                        <h2>
                          National hazard atlas{" "}
                          <Badge tone="neutral">Historical</Badge>
                        </h2>
                        <p>Explore the record. Understand the context.</p>
                      </div>
                      <div className="map-toolbar">
                        <select
                          aria-label="Country filter"
                          value={country}
                          onChange={(e) => setCountry(e.target.value)}
                        >
                          <option>India</option>
                          <option value="all">Global view</option>
                          <option>Nepal</option>
                          <option>United States</option>
                          <option>China</option>
                        </select>
                        <select
                          aria-label="Event size filter"
                          value={size}
                          onChange={(e) => setSize(e.target.value)}
                        >
                          <option value="all">All event sizes</option>
                          <option value="large">Large</option>
                          <option value="medium">Medium</option>
                          <option value="small">Small</option>
                          <option value="unknown">Unknown</option>
                        </select>
                        {page === "explorer" && (
                          <select
                            aria-label="Year filter"
                            value={year}
                            onChange={(e) => setYear(e.target.value)}
                          >
                            <option value="all">All years</option>
                            {Object.keys(overview.by_year || {})
                              .sort()
                              .map((y) => (
                                <option key={y}>{y}</option>
                              ))}
                          </select>
                        )}
                        <button
                          className="icon-button bordered"
                          aria-label="Download displayed events"
                          onClick={() =>
                            download("nasa-landslide-events.geojson", events)
                          }
                        >
                          <Download size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="atlas-body">
                      <MapView
                        data={events}
                        onSelect={setSelected}
                        large={page === "explorer"}
                        layers={sources}
                      />
                      <div className="atlas-rail">
                        <div className="rail-heading">
                          <h3>On the record</h3>
                          <span>{format(events.features.length)}</span>
                        </div>
                        <div className="rail-search">
                          <Search size={15} />
                          <input
                            aria-label="Search catalog"
                            placeholder="Search location or event…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                        </div>
                        <div className="event-list">
                          {eventList
                            .slice(0, page === "explorer" ? 40 : 5)
                            .map((f: Any) => (
                              <button
                                className="event-item"
                                key={f.id}
                                onClick={() => setSelected(f)}
                              >
                                <span
                                  className={`event-icon ${["large", "very_large", "catastrophic"].includes(f.properties.size) ? "terracotta" : "green"}`}
                                >
                                  <Mountain size={17} />
                                </span>
                                <div>
                                  <h4>
                                    {f.properties.region !== "Unknown"
                                      ? f.properties.region
                                      : f.properties.country}
                                  </h4>
                                  <p>{f.properties.title}</p>
                                  <span>
                                    {f.properties.date} <b>·</b>{" "}
                                    {f.properties.size.replace("_", " ")}
                                  </span>
                                </div>
                                <ChevronRight size={13} />
                              </button>
                            ))}
                          {!eventList.length && (
                            <div className="rail-empty">
                              No events match these filters.
                            </div>
                          )}
                        </div>
                        <div className="rail-footer">
                          <Info size={15} />
                          <span>
                            Event reports show history, not current hazard
                            probability.
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="panel-footer">
                      <span>
                        <i className="dot green" />
                        Source: NASA Global Landslide Catalog
                      </span>
                      <button
                        className="text-button"
                        onClick={() => navigate("sources")}
                      >
                        View data provenance <ArrowUpRight size={13} />
                      </button>
                    </div>
                  </div>
                  {page === "overview" && (
                    <div className="bottom-grid">
                      <div className="panel workflow-panel">
                        <div className="panel-header">
                          <div>
                            <h2>From evidence to action</h2>
                            <p>A considered path to harmonized records.</p>
                          </div>
                          <GitMerge size={19} />
                        </div>
                        <div className="workflow-steps">
                          {[
                            [
                              "01",
                              "Bring sources together",
                              "Import departmental GeoJSON layers.",
                              "sources",
                              Database,
                            ],
                            [
                              "02",
                              "Resolve the differences",
                              "Inspect geometry and attribute evidence.",
                              "harmonize",
                              GitMerge,
                            ],
                            [
                              "03",
                              "Make a traceable decision",
                              "Approve safe corrections or request a survey.",
                              "audit",
                              ShieldCheck,
                            ],
                          ].map(([num, title, text, id, Icon]: Any) => (
                            <button onClick={() => navigate(id)} key={num}>
                              <span className="step-num">{num}</span>
                              <div>
                                <strong>{title}</strong>
                                <p>{text}</p>
                              </div>
                              <Icon size={19} />
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="panel coverage-panel">
                        <div className="panel-header">
                          <div>
                            <h2>Where reports concentrate</h2>
                            <p>
                              Top regions in the India catalog · not a risk
                              ranking
                            </p>
                          </div>
                        </div>
                        <div className="region-bars">
                          {(overview.by_region || []).map(
                            ([name, n]: Any, i: number) => (
                              <div key={name}>
                                <div>
                                  <span>{name}</span>
                                  <strong>{format(n)}</strong>
                                </div>
                                <div className="bar-track">
                                  <i
                                    style={{
                                      width: `${(n / overview.by_region[0][1]) * 100}%`,
                                      opacity: 1 - i * 0.12,
                                    }}
                                  />
                                </div>
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                      <div className="trust-card">
                        <div className="trust-icon">
                          <ShieldCheck size={27} />
                        </div>
                        <div className="eyebrow">BUILT FOR ACCOUNTABILITY</div>
                        <h2>
                          Confidence, with
                          <br />
                          the evidence to match.
                        </h2>
                        <p>
                          Original boundaries are preserved. Sensitive conflicts
                          stay with people who can verify them.
                        </p>
                        <button onClick={() => navigate("harmonize")}>
                          Explore harmonization <ArrowRight size={16} />
                        </button>
                        <div className="trust-decoration" />
                      </div>
                    </div>
                  )}
                  {page === "explorer" && (
                    <div className="notice">
                      <Info size={18} />
                      <div>
                        <strong>Coverage is explicit.</strong> Landslide
                        observations are available. Flood, coastal, and
                        cloudburst assessments require your own authoritative
                        hazard layers. Missing reports do not imply a safe
                        location.
                      </div>
                    </div>
                  )}
                </>
              )}
              {page === "harmonize" && (
                <>
                  <div className="tier-grid">
                    <div>
                      <span className="tier-number green">01</span>
                      <div>
                        <strong>Ready for review</strong>
                        <p>
                          Score ≥85 · complete legal evidence · matching
                          boundaries
                        </p>
                      </div>
                      <b>{matches.filter((m) => m.tier === "ready").length}</b>
                    </div>
                    <div>
                      <span className="tier-number amber">02</span>
                      <div>
                        <strong>Reviewer queue</strong>
                        <p>Score 60–84 · inspect source disagreements</p>
                      </div>
                      <b>{matches.filter((m) => m.tier === "review").length}</b>
                    </div>
                    <div>
                      <span className="tier-number terracotta">03</span>
                      <div>
                        <strong>Field verification</strong>
                        <p>Score &lt;60 or sensitive / incomplete evidence</p>
                      </div>
                      <b>{matches.filter((m) => m.tier === "field").length}</b>
                    </div>
                  </div>
                  <div className="panel">
                    <div className="panel-header">
                      <div>
                        <h2>Spatial matching engine</h2>
                        <p>
                          Geometry + position + attributes + declared source
                          quality. A rule-based score, not an ML probability.
                        </p>
                      </div>
                    </div>
                    <div className="match-controls">
                      <label>
                        REFERENCE LAYER
                        <select
                          value={left}
                          onChange={(e) => setLeft(e.target.value)}
                        >
                          <option value="">Select a source…</option>
                          {eligibleSources.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <GitMerge size={23} />
                      <label>
                        COMPARISON LAYER
                        <select
                          value={right}
                          onChange={(e) => setRight(e.target.value)}
                        >
                          <option value="">Select a source…</option>
                          {eligibleSources.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="button primary"
                        disabled={!left || !right || left === right || busy}
                        onClick={() =>
                          run(async () => {
                            const r = await api("harmonize", {
                              left_source: left,
                              right_source: right,
                            });
                            await refresh();
                            setToast(
                              `${r.matches.length} features matched. Review the evidence below.`,
                            );
                          })
                        }
                      >
                        <GitMerge size={16} />
                        Run harmonization
                      </button>
                    </div>
                  </div>
                  <div className="panel">
                    <div className="panel-header">
                      <div className="tabs">
                        {[
                          ["all", "All matches"],
                          ["pending", "Pending"],
                          ["ready", "Ready"],
                          ["review", "Review"],
                          ["field", "Field verification"],
                        ].map(([id, label]) => (
                          <button
                            className={tab === id ? "active" : ""}
                            onClick={() => setTab(id)}
                            key={id}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <button
                        className="text-button"
                        onClick={() =>
                          run(async () =>
                            download(
                              "harmonized-records.geojson",
                              await api("export"),
                            ),
                          )
                        }
                      >
                        <Download size={14} />
                        Export approved
                      </button>
                    </div>
                    {filteredMatches.length ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>FEATURE PAIR</th>
                              <th>EVIDENCE SCORE</th>
                              <th>ROUTING</th>
                              <th>CONFLICTS</th>
                              <th>STATUS</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {filteredMatches.map((m) => (
                              <tr key={m.id}>
                                <td>
                                  <strong>{m.left_id}</strong>
                                  <small>↔ {m.right_id || "No match"}</small>
                                </td>
                                <td>
                                  <div className="score">
                                    <strong>{m.confidence}</strong>
                                    <div>
                                      <i
                                        style={{ width: `${m.confidence}%` }}
                                      />
                                    </div>
                                  </div>
                                </td>
                                <td>
                                  <Badge
                                    tone={
                                      m.tier === "field"
                                        ? "terracotta"
                                        : m.tier === "review"
                                          ? "amber"
                                          : "green"
                                    }
                                  >
                                    {m.tier === "field"
                                      ? "Field verification"
                                      : m.tier === "ready"
                                        ? "Ready for review"
                                        : "Reviewer queue"}
                                  </Badge>
                                </td>
                                <td>
                                  {m.conflicts.length
                                    ? `${m.conflicts.length} issues`
                                    : "Sources agree"}
                                </td>
                                <td>{m.status}</td>
                                <td>
                                  <button
                                    className="text-button"
                                    onClick={() => {
                                      setReview(m);
                                      setReason("");
                                    }}
                                  >
                                    Review <ArrowUpRight size={14} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty
                        icon={GitMerge}
                        title="Start with two perspectives."
                        text="Import cadastral, revenue, or survey layers, then compare them. No fabricated ownership records are preloaded."
                        action={
                          <button
                            className="button secondary"
                            onClick={() => setUpload(true)}
                          >
                            <Upload size={15} />
                            Import a source
                          </button>
                        }
                      />
                    )}
                  </div>
                  <div className="notice">
                    <Shield size={18} />
                    <div>
                      <strong>Original records stay intact.</strong> Approval
                      publishes a separate, reversible land-use correction with
                      explicit source precedence. Ownership, title, and boundary
                      conflicts require field verification. Confidence
                      thresholds never bypass these checks.
                    </div>
                  </div>
                </>
              )}
              {page === "relocation" && (
                <>
                  <div className="panel">
                    <div className="panel-header">
                      <div>
                        <h2>Carrying capacity & exposure</h2>
                        <p>
                          Use your site's actual polygon and water supply. All
                          assumptions remain visible.
                        </p>
                      </div>
                      <Badge tone="amber">Decision support</Badge>
                    </div>
                    <div className="planning-controls">
                      <label>
                        SPACE PER PERSON{" "}
                        <div className="input-unit">
                          <input
                            type="number"
                            min="10"
                            max="1000"
                            value={area}
                            onChange={(e) => setArea(+e.target.value)}
                          />
                          <span>m²</span>
                        </div>
                      </label>
                      <label>
                        WATER PER PERSON / DAY{" "}
                        <div className="input-unit">
                          <input
                            type="number"
                            min="1"
                            max="1000"
                            value={water}
                            onChange={(e) => setWater(+e.target.value)}
                          />
                          <span>litres</span>
                        </div>
                      </label>
                      <div className="planning-formula">
                        Capacity = minimum of
                        <br />
                        <strong>land capacity & water capacity</strong>
                      </div>
                      <button
                        className="button primary"
                        disabled={
                          busy || !sources.some((s) => s.kind === "site")
                        }
                        onClick={() =>
                          run(async () => {
                            setScreen(
                              await api("relocation", {
                                sqm_per_person: area,
                                liters_per_person: water,
                              }),
                            );
                            await refresh();
                          })
                        }
                      >
                        <Route size={16} />
                        Screen sites
                      </button>
                    </div>
                    <div className="panel-footer">
                      <span>
                        Planning assumptions are editable, not asserted
                        regulatory standards.
                      </span>
                      <span>
                        {sources.filter((s) => s.kind === "site").length} site
                        layers ·{" "}
                        {sources.filter((s) => s.kind === "hazard").length}{" "}
                        hazard layers ·{" "}
                        {sources.filter((s) => s.kind === "habitation").length}{" "}
                        habitation layers
                      </span>
                    </div>
                  </div>
                  {screen ? (
                    <>
                      <div className="site-grid">
                        {screen.sites.map((s: Any) => (
                          <div className="panel site-card" key={s.id}>
                            <div className="site-head">
                              <div className="empty-icon">
                                <MapPin size={22} />
                              </div>
                              <Badge
                                tone={
                                  s.status === "excluded"
                                    ? "terracotta"
                                    : "amber"
                                }
                              >
                                {s.status}
                              </Badge>
                            </div>
                            <h2>{s.name}</h2>
                            <div className="site-capacity">
                              {s.capacity === null ? "—" : format(s.capacity)}
                              <span>estimated people capacity</span>
                            </div>
                            <dl>
                              <div>
                                <dt>Measured polygon area</dt>
                                <dd>
                                  {s.area_m2 === null
                                    ? "Not assessed"
                                    : `${format(s.area_m2)} m²`}
                                </dd>
                              </div>
                              <div>
                                <dt>Land / water capacity</dt>
                                <dd>
                                  {s.area_capacity ?? "—"} /{" "}
                                  {s.water_capacity ?? "—"}
                                </dd>
                              </div>
                              <div>
                                <dt>Historical events within 10 km</dt>
                                <dd>{s.historical_events_10km}</dd>
                              </div>
                              <div>
                                <dt>Exposed population in uploaded layers</dt>
                                <dd>{s.population_demand ?? "Not assessed"}</dd>
                              </div>
                            </dl>
                            {s.exposed_habitations.length > 0 && (
                              <div className="site-homes">
                                <strong>Nearby exposed habitations</strong>
                                {s.exposed_habitations
                                  .slice(0, 5)
                                  .map((h: Any) => (
                                    <p key={h.id}>
                                      {h.name} · {h.population} people ·{" "}
                                      {h.distance_km} km
                                    </p>
                                  ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      <button
                        className="button secondary"
                        onClick={() =>
                          download("relocation-screening.json", screen)
                        }
                      >
                        <Download size={15} />
                        Export screening
                      </button>
                    </>
                  ) : (
                    <div className="panel">
                      <Empty
                        icon={Route}
                        title="Good decisions start with real places."
                        text="Import site polygons with water_lpd, habitation features with population, and authoritative hazard polygons. The planner will measure, intersect, and compare them."
                        action={
                          <button
                            className="button primary"
                            onClick={() => setUpload(true)}
                          >
                            <Plus size={16} />
                            Import planning data
                          </button>
                        }
                      />
                    </div>
                  )}
                  <div className="notice">
                    <Info size={19} />
                    <div>
                      <strong>Screening is not certification.</strong> Sites
                      intersecting supplied hazards are excluded. Missing hazard
                      or capacity data produces “not assessed”. All other sites
                      still require title, infrastructure, hazard-coverage, and
                      field checks. Historical event density alone cannot
                      establish safety.
                    </div>
                  </div>
                </>
              )}
              {page === "sources" && (
                <>
                  <div className="source-grid">
                    <div className="panel dataset-card">
                      <div className="dataset-top">
                        <div className="dataset-mark nasa">NASA</div>
                        <Badge>Downloaded & traced</Badge>
                      </div>
                      <h2>Global Landslide Catalog</h2>
                      <p>
                        Documented landslide reports with locations, reported
                        size, triggers, and links to original sources.
                      </p>
                      <div className="dataset-metrics">
                        <div>
                          <strong>{format(overview.total_events)}</strong>
                          <span>geolocated records</span>
                        </div>
                        <div>
                          <strong>{format(overview.india_events)}</strong>
                          <span>India observations</span>
                        </div>
                      </div>
                      <div className="source-note">
                        Historical, reporting-biased inventory. Location
                        precision varies. Catalog metadata does not specify a
                        license; attribution and report links are retained.
                      </div>
                      <a
                        className="text-button"
                        href="https://catalog.data.gov/dataset/global-landslide-catalog-export"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open official catalog <ExternalLink size={14} />
                      </a>
                    </div>
                    <div className="panel dataset-card">
                      <div className="dataset-top">
                        <div className="dataset-mark uci">UCI</div>
                        <Badge>CC BY 4.0</Badge>
                      </div>
                      <h2>Forest Covertype</h2>
                      <p>
                        Measured forest cover from the US Forest Service, paired
                        with terrain and cartographic variables.
                      </p>
                      <div className="dataset-metrics">
                        <div>
                          <strong>581,012</strong>
                          <span>source observations</span>
                        </div>
                        <div>
                          <strong>150,000</strong>
                          <span>training + test sample</span>
                        </div>
                      </div>
                      <div className="source-note">
                        Blackard, J. (1998). Covertype. DOI: 10.24432/C50K5N.
                        Colorado research benchmark; not validated for Indian
                        forests.
                      </div>
                      <a
                        className="text-button"
                        href="https://archive.ics.uci.edu/dataset/31/covertype"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open UCI dataset <ExternalLink size={14} />
                      </a>
                    </div>
                  </div>
                  <div className="panel">
                    <div className="panel-header">
                      <div>
                        <h2>
                          Your departmental layers{" "}
                          <Badge tone="neutral">{sources.length}</Badge>
                        </h2>
                        <p>
                          Original features are persisted locally with content
                          hashes and source lineage.
                        </p>
                      </div>
                      <button
                        className="button secondary"
                        onClick={() => setUpload(true)}
                      >
                        <Upload size={15} />
                        Import GeoJSON
                      </button>
                    </div>
                    {sources.length ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>SOURCE</th>
                              <th>TYPE</th>
                              <th>FEATURES</th>
                              <th>DECLARED QUALITY</th>
                              <th>SHA-256</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {sources.map((s) => (
                              <tr key={s.id}>
                                <td>
                                  <strong>{s.name}</strong>
                                  <small>
                                    {new Date(
                                      s.created_at,
                                    ).toLocaleDateString()}
                                  </small>
                                </td>
                                <td>
                                  <Badge tone="neutral">{s.kind}</Badge>
                                </td>
                                <td>{s.geojson.features.length}</td>
                                <td>
                                  {s.reliability}/100{" "}
                                  <small>User supplied</small>
                                </td>
                                <td>
                                  <code title={s.checksum}>
                                    {s.checksum.slice(0, 14)}…
                                  </code>
                                </td>
                                <td>
                                  <button
                                    className="icon-button"
                                    aria-label={`Download ${s.name}`}
                                    onClick={() =>
                                      download(`${s.name}.geojson`, s.geojson)
                                    }
                                  >
                                    <Download size={16} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty
                        icon={Database}
                        title="Your sources belong here."
                        text="Connect the evidence your departments already hold. Upload up to 250 features per GeoJSON layer in WGS84 coordinates."
                      />
                    )}
                  </div>
                  <div className="panel schema-card">
                    <BookOpen size={22} />
                    <div>
                      <h3>A simple, explicit data contract</h3>
                      <p>
                        Records:{" "}
                        <code>parcel_id, owner, title_id, land_use</code> ·
                        Sites: <code>name, water_lpd</code> · Habitations:{" "}
                        <code>name, population</code>. Cadastral, survey,
                        revenue, site, and hazard layers require polygons.
                        Habitations may use points or polygons. Uploading a file
                        does not establish its legal authority.
                      </p>
                    </div>
                  </div>
                </>
              )}
              {page === "models" && (
                <>
                  <div className="model-cards">
                    {models.map((m) => (
                      <button
                        className={`panel model-card ${currentModel?.id === m.id ? "chosen" : ""}`}
                        key={m.id}
                        onClick={() => setModelId(m.id)}
                      >
                        <div className="model-card-top">
                          <FlaskConical size={22} />
                          <Badge>Trained locally</Badge>
                        </div>
                        <h2>{m.title}</h2>
                        <p>{m.source}</p>
                        <div className="model-metrics">
                          <div>
                            <strong>{percent(m.metrics.accuracy)}</strong>
                            <span>holdout accuracy</span>
                          </div>
                          <div>
                            <strong>
                              {percent(m.metrics.baseline_accuracy)}
                            </strong>
                            <span>majority baseline</span>
                          </div>
                          <div>
                            <strong>{format(m.train_rows)}</strong>
                            <span>training rows</span>
                          </div>
                        </div>
                        <div className="model-card-footer">
                          {m.algorithm} <ArrowUpRight size={16} />
                        </div>
                      </button>
                    ))}
                  </div>
                  {currentModel && (
                    <>
                      <div className="notice">
                        <Info size={18} />
                        <div>
                          <strong>Scope of this model.</strong>{" "}
                          {currentModel.limitation}
                        </div>
                      </div>
                      <div className="model-workbench">
                        <div className="panel">
                          <div className="panel-header">
                            <div>
                              <h2>Inference workbench</h2>
                              <p>Run the actual saved model on your input.</p>
                            </div>
                            {currentModel.sample && (
                              <button
                                className="text-button"
                                onClick={() => {
                                  setInputs(currentModel.sample);
                                  setPrediction(null);
                                }}
                              >
                                Load real test observation
                              </button>
                            )}
                          </div>
                          <form
                            className="inference-form"
                            onSubmit={(e) => {
                              e.preventDefault();
                              run(async () =>
                                setPrediction(
                                  await api(
                                    `models/${currentModel.id}/predict`,
                                    { features: inputs },
                                  ),
                                ),
                              );
                            }}
                          >
                            <div className="input-grid">
                              {currentModel.inputs.map((f: Any) => (
                                <label key={f.name}>
                                  {f.label}
                                  {f.type === "number" ? (
                                    <input
                                      required
                                      type="number"
                                      step="any"
                                      min={f.min}
                                      max={f.max}
                                      value={inputs[f.name] ?? ""}
                                      onChange={(e) =>
                                        setInputs({
                                          ...inputs,
                                          [f.name]:
                                            e.target.value === ""
                                              ? ""
                                              : Number(e.target.value),
                                        })
                                      }
                                    />
                                  ) : (
                                    <select
                                      value={inputs[f.name] || f.default}
                                      onChange={(e) =>
                                        setInputs({
                                          ...inputs,
                                          [f.name]: e.target.value,
                                        })
                                      }
                                    >
                                      {f.options.map((o: string) => (
                                        <option key={o}>{o}</option>
                                      ))}
                                    </select>
                                  )}
                                </label>
                              ))}
                            </div>
                            <button
                              className="button primary"
                              disabled={busy}
                              type="submit"
                            >
                              <Activity size={16} />
                              Run model inference
                            </button>
                          </form>
                          {prediction &&
                            prediction.model_id === currentModel.id && (
                              <div className="prediction">
                                <div className="eyebrow">MODEL OUTPUT</div>
                                <h2>{prediction.prediction}</h2>
                                {prediction.probabilities.map((p: Any) => (
                                  <div className="probability" key={p.label}>
                                    <span>{p.label}</span>
                                    <div>
                                      <i
                                        style={{
                                          width: percent(p.probability),
                                        }}
                                      />
                                    </div>
                                    <strong>{percent(p.probability)}</strong>
                                  </div>
                                ))}
                                <p>{prediction.probability_note}</p>
                              </div>
                            )}
                        </div>
                        <div className="panel evaluation">
                          <div className="panel-header">
                            <div>
                              <h2>Evaluation, openly</h2>
                              <p>
                                Frozen holdout · random seed {currentModel.seed}
                              </p>
                            </div>
                            <ShieldCheck size={19} />
                          </div>
                          <dl>
                            <div>
                              <dt>Balanced accuracy</dt>
                              <dd>
                                {percent(
                                  currentModel.metrics.balanced_accuracy,
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt>Macro F1</dt>
                              <dd>
                                {currentModel.metrics.macro_f1.toFixed(3)}
                              </dd>
                            </div>
                            <div>
                              <dt>Test observations</dt>
                              <dd>{format(currentModel.test_rows)}</dd>
                            </div>
                            <div>
                              <dt>Predictor variables</dt>
                              <dd>{currentModel.features}</dd>
                            </div>
                          </dl>
                          <div className="evaluation-text">
                            <h4>Split strategy</h4>
                            <p>{currentModel.split}</p>
                            <h4>Target</h4>
                            <p>{currentModel.target}</p>
                            <h4>Artifact fingerprint</h4>
                            <code>{currentModel.artifact_sha256}</code>
                            <p>
                              Trained{" "}
                              {new Date(
                                currentModel.trained_at,
                              ).toLocaleString()}
                            </p>
                            <button
                              className="button secondary"
                              onClick={() =>
                                download(
                                  `${currentModel.id}-model-card.json`,
                                  currentModel,
                                )
                              }
                            >
                              <Download size={14} />
                              Download full model card
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="panel">
                        <div className="panel-header">
                          <div>
                            <h2>Holdout confusion matrix</h2>
                            <p>
                              Rows are actual labels. Columns are predicted
                              labels. Every number comes from the held-out data.
                            </p>
                          </div>
                        </div>
                        <div className="table-scroll">
                          <table className="matrix">
                            <thead>
                              <tr>
                                <th>ACTUAL ↓ / PREDICTED →</th>
                                {currentModel.classes.map((c: string) => (
                                  <th key={c}>{c}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {currentModel.confusion_matrix.map(
                                (row: number[], i: number) => (
                                  <tr key={i}>
                                    <th>{currentModel.classes[i]}</th>
                                    {row.map((n, j) => (
                                      <td
                                        className={i === j ? "diagonal" : ""}
                                        key={j}
                                      >
                                        {format(n)}
                                      </td>
                                    ))}
                                  </tr>
                                ),
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
              {page === "audit" && (
                <>
                  <div className="audit-banner">
                    <ShieldCheck size={26} />
                    <div>
                      <strong>
                        {audit.valid
                          ? "Audit chain verified"
                          : "Audit integrity check failed"}
                      </strong>
                      <p>
                        {audit.entries.length} recorded actions · SHA-256 linked
                        entries · persisted locally
                      </p>
                    </div>
                    <button
                      className="button secondary"
                      onClick={() => download("bhoomi-audit-trail.json", audit)}
                    >
                      <Download size={15} />
                      Export audit
                    </button>
                  </div>
                  <div className="panel">
                    {audit.entries.length ? (
                      <div className="audit-list">
                        {audit.entries.map((a: Any) => (
                          <div className="audit-item" key={a.id}>
                            <div className="audit-icon">
                              <FileCheck2 size={18} />
                            </div>
                            <div>
                              <div className="audit-title">
                                <h3>{a.action.replaceAll(".", " / ")}</h3>
                                <time>{new Date(a.at).toLocaleString()}</time>
                              </div>
                              <p>{a.reason}</p>
                              <div className="audit-meta">
                                <span>{a.actor}</span>
                                <code>{a.hash.slice(0, 20)}…</code>
                              </div>
                              <details>
                                <summary>
                                  Inspect evidence & change record
                                </summary>
                                <pre>{JSON.stringify(a.payload, null, 2)}</pre>
                              </details>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        icon={ShieldCheck}
                        title="A clean slate. A clear record."
                        text="Source imports, matching runs, review decisions, reversals, and site screenings will appear here automatically."
                      />
                    )}
                  </div>
                  <div className="notice">
                    <Info size={17} />
                    <span>
                      This is a local, single-user audit trail. Hash linking
                      detects inconsistencies; it does not provide external
                      notarization or production identity verification.
                    </span>
                  </div>
                </>
              )}
            </>
          )}
          <footer>
            <span>
              <Mountain size={14} /> Bhoomi Suraksha <b>·</b> Evidence-led land
              intelligence
            </span>
            <span>
              {hosted ? "Hosted research pilot" : "Local research pilot"} <i />{" "}
              Human review by design
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Info size={18} />
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {upload && (
        <UploadModal
          config={config}
          close={() => setUpload(false)}
          save={async (data: Any) => {
            await api("sources", data);
            await refresh();
            setUpload(false);
            setToast(
              "Source imported. Original features and provenance saved.",
            );
          }}
        />
      )}
      {selected && (
        <div className="drawer-backdrop" onClick={() => setSelected(null)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-top">
              <Badge tone="terracotta">Historical observation</Badge>
              <button
                className="icon-button"
                aria-label="Close event"
                onClick={() => setSelected(null)}
              >
                <X size={20} />
              </button>
            </div>
            <Mountain size={40} className="drawer-mountain" />
            <h2>{selected.properties.title}</h2>
            <p>
              {selected.properties.region}, {selected.properties.country}
            </p>
            <dl>
              {[
                ["Event date", selected.properties.date],
                ["Reported size", selected.properties.size],
                ["Trigger", selected.properties.trigger],
                ["Category", selected.properties.category],
                ["Location precision", selected.properties.accuracy],
                [
                  "Reported fatalities",
                  selected.properties.fatalities ?? "Not reported",
                ],
                [
                  "Coordinates",
                  selected.geometry.coordinates
                    .map((c: number) => c.toFixed(4))
                    .join(", "),
                ],
              ].map(([a, b]) => (
                <div key={a}>
                  <dt>{a}</dt>
                  <dd>{b}</dd>
                </div>
              ))}
            </dl>
            <h3>Original report</h3>
            <p className="event-description">
              {selected.properties.description ||
                "No description provided in the source."}
            </p>
            {/^https?:\/\//.test(selected.properties.source_url) && (
              <a
                className="button secondary"
                href={selected.properties.source_url}
                target="_blank"
                rel="noreferrer"
              >
                {selected.properties.source || "Original source"}{" "}
                <ExternalLink size={15} />
              </a>
            )}
            <div className="notice">
              <Info size={17} />
              <span>
                NASA event #{selected.properties.id}. Source reports may be
                incomplete. A historical event is not a current hazard forecast.
              </span>
            </div>
          </aside>
        </div>
      )}
      {review && (
        <div className="modal-backdrop">
          <section
            className="modal review-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Review match"
          >
            <div className="modal-top">
              <div>
                <div className="eyebrow">EVIDENCE REVIEW</div>
                <h2>
                  {review.left_id} ↔ {review.right_id || "Unmatched"}
                </h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close review"
                onClick={() => setReview(null)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="review-score">
              <strong>
                {review.confidence}
                <span>/100</span>
              </strong>
              <div>
                <h3>Evidence score</h3>
                <p>Transparent weighted rules · not a learned probability</p>
              </div>
              <Badge tone={review.legal_sensitive ? "terracotta" : "green"}>
                {review.legal_sensitive
                  ? "Field verification required"
                  : "Reviewable"}
              </Badge>
            </div>
            <dl>
              {Object.entries(review.evidence)
                .filter(([k]) =>
                  [
                    "geometry_iou",
                    "centroid_distance_m",
                    "position_score",
                    "attribute_agreement",
                    "source_reliability",
                  ].includes(k),
                )
                .map(([k, v]) => (
                  <div key={k}>
                    <dt>{k.replaceAll("_", " ")}</dt>
                    <dd>{String(v)}</dd>
                  </div>
                ))}
            </dl>
            {review.conflicts.length > 0 && (
              <div className="conflict-list">
                {review.conflicts.map((c: string) => (
                  <p key={c}>
                    <AlertTriangle size={14} />
                    {c}
                  </p>
                ))}
              </div>
            )}
            <details>
              <summary>
                Inspect original, comparison, and proposed records
              </summary>
              <pre>
                {JSON.stringify(
                  {
                    original: review.original,
                    comparison: review.comparison,
                    proposed: review.proposed,
                    attribute_resolution: review.attribute_resolution,
                    topology_repair_preview: review.topology_repair_preview,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
            <label className="reason-label">
              REVIEW REASON
              <textarea
                placeholder="Explain your decision (at least 10 characters)…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                minLength={10}
              />
            </label>
            <div className="modal-actions">
              {(review.status === "approved"
                ? ["revert"]
                : ["pending", "reverted"].includes(review.status)
                  ? ["reject", "field", "approve"]
                  : []
              ).map((action) => (
                <button
                  className={`button ${action === "approve" ? "primary" : "secondary"}`}
                  key={action}
                  disabled={
                    busy ||
                    reason.trim().length < 10 ||
                    (action === "approve" &&
                      (review.legal_sensitive || review.tier === "field"))
                  }
                  onClick={() =>
                    run(async () => {
                      await api(`matches/${review.id}/decision`, {
                        action,
                        reason: reason.trim(),
                      });
                      await refresh();
                      setReview(null);
                      setToast("Decision recorded in the audit trail.");
                    })
                  }
                >
                  {
                    (
                      {
                        approve: "Approve correction",
                        reject: "Reject",
                        field: "Request field verification",
                        revert: "Revert correction",
                      } as Any
                    )[action]
                  }
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function Stat({ label, value, detail, icon: Icon, color = "green" }: Any) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <Icon size={18} className={color} />
      </div>
      <strong>{value}</strong>
      <div className="stat-detail">
        <span className={`tiny-dot ${color}`} />
        {detail}
      </div>
    </div>
  );
}
function UploadModal({ close, save, config }: Any) {
  const [name, setName] = useState(""),
    [kind, setKind] = useState("cadastral"),
    [quality, setQuality] = useState(75),
    [file, setFile] = useState<Any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Import layer"
      >
        <div className="modal-top">
          <div>
            <div className="eyebrow">BRING YOUR EVIDENCE</div>
            <h2>Import a geospatial layer</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close import"
            onClick={close}
          >
            <X size={20} />
          </button>
        </div>
        <p>
          {config.deployment_mode === "public"
            ? `Uploads are stored on the hosting server in your isolated browser workspace. Access expires after 7 days; export your work before then. ${config.storage_ephemeral ? "This free host resets uploads and decisions when it sleeps, restarts, or redeploys. " : ""}Do not upload confidential official records to this public research demo.`
            : "Source data stays in this local workspace."}{" "}
          Each import retains its original features and a SHA-256 fingerprint.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              if (!file) throw Error("Choose a GeoJSON file.");
              if (file.size > config.max_upload_mb * 1024 * 1024)
                throw Error(
                  `File must be smaller than ${config.max_upload_mb} MB.`,
                );
              await save({
                name,
                kind,
                reliability: quality,
                geojson: JSON.parse(await file.text()),
              });
            } catch (e: Any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="file-drop">
            <Upload size={28} />
            <strong>{file ? file.name : "Choose your GeoJSON file"}</strong>
            <span>
              WGS84 · up to 250 features · maximum {config.max_upload_mb} MB
            </span>
            <input
              type="file"
              aria-label="GeoJSON file"
              accept=".geojson,.json,application/geo+json,application/json"
              onChange={(e) => {
                setFile(e.target.files?.[0]);
                if (!name)
                  setName(
                    e.target.files?.[0]?.name.replace(
                      /\.(geojson|json)$/,
                      "",
                    ) || "",
                  );
              }}
            />
          </label>
          <div className="input-grid">
            <label>
              Source name
              <input
                required
                minLength={2}
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Revenue records · Ward 12"
              />
            </label>
            <label>
              Layer type
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {[
                  "cadastral",
                  "revenue",
                  "survey",
                  "habitation",
                  "site",
                  "hazard",
                ].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Declared source quality · {quality}/100
            <input
              type="range"
              min="0"
              max="100"
              value={quality}
              onChange={(e) => setQuality(+e.target.value)}
            />
          </label>
          <p className="muted">
            This is your assessment of source quality, not a verified authority
            rating.
          </p>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <div className="modal-actions">
            <button className="button secondary" type="button" onClick={close}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={busy || !file}
              type="submit"
            >
              {busy ? "Importing…" : "Import layer"}
              <ArrowRight size={16} />
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
