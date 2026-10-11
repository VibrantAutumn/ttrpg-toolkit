import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getItem } from "../../api/library";
import { getTimelineRecord, setTimelineJson } from "../../api/time";
import { QueryBuilder } from "../../components/queries/QueryBuilder";
import { useQueryCatalog } from "../../components/queries/useQueryCatalog";
import { createAutosaver, type SaveStatus } from "../../lib/autosave";
import { formatDate } from "../../lib/calendar/math";
import {
  axisTicks,
  defaultTimeline,
  normalizeTimeline,
  packEntries,
  windowFor,
  zoomSpanDays,
  ZOOM_LABELS,
  ZOOM_LEVELS,
  type TimelineConfig,
} from "../../lib/timelines/timeline";
import { useDataVersion } from "../../state/dataVersion";
import { useFieldCatalog } from "../../state/fieldCatalog";
import { useNavigation } from "../../state/Navigation";
import { loadTimelineData, type TimelineData } from "../../state/timelineData";
import { useTime } from "../../state/timeState";
import "../../components/time/time.css";

const WIDTH = 1800;
const ROW_PX = 24;
const LANE_LABEL_PX = 22;

/** The page of a timeline: dated things along a time axis, in lanes, zoomable from centuries to days. */
export function TimelineView({ itemId }: { itemId: string }) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [config, setConfig] = useState<TimelineConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([getItem(itemId), getTimelineRecord(itemId)])
      .then(([item, record]) => {
        if (!active) return;
        setProjectId(item.projectId);
        let raw: unknown = null;
        try {
          raw = record ? JSON.parse(record.json) : null;
        } catch {
          raw = null;
        }
        setConfig(raw === null ? defaultTimeline() : normalizeTimeline(raw));
      })
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [itemId]);

  if (error) return <p className="error">{error}</p>;
  if (!config || !projectId) return <p className="empty">Loading...</p>;
  return <TimelineBody itemId={itemId} projectId={projectId} initial={config} />;
}

function TimelineBody({ itemId, projectId, initial }: { itemId: string; projectId: string; initial: TimelineConfig }) {
  const { calendar, state } = useTime();
  const today = state?.nowDay ?? 0;
  const { openItem } = useNavigation();
  const version = useDataVersion();
  const { definitions } = useFieldCatalog(projectId);
  const [config, setConfig] = useState<TimelineConfig>(initial);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [center, setCenter] = useState<number>(initial.centerDay ?? today);
  const [data, setData] = useState<TimelineData | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const saver = useMemo(
    () =>
      createAutosaver({
        save: async (json) => void (await setTimelineJson(itemId, json)),
        delayMs: 600,
        onStatus: setStatus,
      }),
    [itemId],
  );
  const saverRef = useRef(saver);
  saverRef.current = saver;
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && void saverRef.current.flush();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void saverRef.current.flush();
    };
  }, []);

  const change = useCallback(
    (patch: Partial<TimelineConfig>) => {
      setConfig((current) => {
        const next = { ...current, ...patch };
        saver.change(JSON.stringify(next));
        return next;
      });
    },
    [saver],
  );

  const win = useMemo(() => windowFor(calendar, config.zoom, center), [calendar, config.zoom, center]);
  const perDay = WIDTH / Math.max(1, win.to - win.from);
  const catalog = useQueryCatalog(projectId, config.query);

  useEffect(() => {
    let active = true;
    loadTimelineData(projectId, config, calendar, win.from, win.to, today, definitions)
      .then((d) => {
        if (!active) return;
        setData(d);
        setProblem(null);
      })
      .catch((e) => active && setProblem(String(e)));
    return () => {
      active = false;
    };
  }, [projectId, config, calendar, win.from, win.to, today, definitions, version]);

  // Keep the middle of the drawing in view when the zoom or the centre changes.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, (WIDTH - el.clientWidth) / 2);
  }, [config.zoom, center]);

  const ticks = useMemo(() => axisTicks(calendar, config.zoom, win.from, win.to), [calendar, config.zoom, win.from, win.to]);
  const span = Math.max(1, Math.round(zoomSpanDays(calendar, config.zoom)));
  const x = (day: number) => (day - win.from) * perDay;

  return (
    <section>
      <p className="meta">
        {status === "saved" ? "Saved." : status === "error" ? "Couldn't save yet; will try again." : "Saving..."} Centred on {formatDate(calendar, center)}.
      </p>
      <div className="row-list" role="group" aria-label="Zoom">
        {ZOOM_LEVELS.map((z) => (
          <button key={z} type="button" aria-pressed={config.zoom === z} className={config.zoom === z ? "chip on" : "chip"} onClick={() => change({ zoom: z })}>
            {ZOOM_LABELS[z]}
          </button>
        ))}
      </div>
      <div className="row-list">
        <button type="button" onClick={() => setCenter((c) => c - span)}>
          ◀ Earlier
        </button>
        <button type="button" onClick={() => setCenter(today)}>
          Current date
        </button>
        <button type="button" onClick={() => setCenter((c) => c + span)}>
          Later ▶
        </button>
        <button type="button" aria-expanded={showSettings} onClick={() => setShowSettings((s) => !s)}>
          {showSettings ? "Hide settings" : "Settings"}
        </button>
      </div>

      {showSettings && (
        <div className="day-detail stack">
          <h3>What is shown</h3>
          <div className="row-list">
            {(["events", "notes", "sessions", "properties"] as const).map((key) => (
              <label key={key} className="check">
                <input type="checkbox" checked={config.sources[key]} onChange={(e) => change({ sources: { ...config.sources, [key]: e.currentTarget.checked } })} />
                {{ events: "Events", notes: "DM notes", sessions: "Sessions", properties: "Pages with a date property" }[key]}
              </label>
            ))}
          </div>
          <h3>Lanes</h3>
          <div className="row-list">
            <select
              aria-label="Make lanes by"
              value={config.lanes.by}
              onChange={(e) => {
                const by = e.currentTarget.value;
                if (by === "tag") change({ lanes: { by: "tag", parentTagId: null } });
                else if (by === "field") {
                  const first = catalog.fields.find((d) => d.kind === "dropdown");
                  change({ lanes: first ? { by: "field", fieldId: first.id } : { by: "none" } });
                } else change({ lanes: by === "kind" ? { by: "kind" } : { by: "none" } });
              }}
            >
              <option value="none">One lane</option>
              <option value="kind">By kind (events, notes, sessions, pages)</option>
              <option value="tag">By tag</option>
              <option value="field" disabled={!catalog.fields.some((d) => d.kind === "dropdown")}>
                By a dropdown property
              </option>
            </select>
            {config.lanes.by === "tag" && (
              <label>
                One lane for each tag inside
                <select value={config.lanes.parentTagId ?? ""} onChange={(e) => change({ lanes: { by: "tag", parentTagId: e.currentTarget.value || null } })}>
                  <option value="">(top-level tags)</option>
                  {catalog.tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {config.lanes.by === "field" && (
              <select
                aria-label="Property"
                value={config.lanes.fieldId}
                onChange={(e) => change({ lanes: { by: "field", fieldId: e.currentTarget.value } })}
              >
                {catalog.fields
                  .filter((d) => d.kind === "dropdown")
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            )}
          </div>
          <h3>Which items</h3>
          <p className="meta">With no rules, everything that has a date is shown.</p>
          <QueryBuilder projectId={projectId} query={config.query} catalog={catalog} onChange={(query) => change({ query })} />
        </div>
      )}

      {problem && <p className="error">{problem}</p>}
      {data?.truncated && <p className="meta">The rules found more items than can be shown, so some may be missing.</p>}
      <div className="timeline" ref={scroller} aria-label="Timeline">
        <div style={{ width: WIDTH, position: "relative" }}>
          <div className="timeline-axis">
            {ticks.map((t) => (
              <span key={t.day} style={{ left: x(t.day) }}>
                {t.label}
              </span>
            ))}
          </div>
          {data && data.lanes.length === 0 && <p className="empty" style={{ padding: "0.5rem" }}>Nothing dated in this stretch of time.</p>}
          {data?.lanes.map((lane) => {
            const placed = packEntries(
              data.entries.filter((e) => e.laneKey === lane.key),
              win.from,
              win.to,
              WIDTH,
            );
            const rows = placed.reduce((max, p) => Math.max(max, p.row + 1), 1);
            return (
              <div key={lane.key} className="timeline-lane" style={{ height: LANE_LABEL_PX + rows * ROW_PX + 4 }}>
                <span className="timeline-lane-label">{lane.label}</span>
                {placed.map((p) => (
                  <button
                    key={p.entry.key}
                    type="button"
                    className="timeline-item"
                    title={`${p.entry.label} (${formatDate(calendar, p.entry.day)}${p.entry.endDay > p.entry.day ? ` to ${formatDate(calendar, p.entry.endDay)}` : ""})`}
                    style={{ left: p.left, width: p.width, top: LANE_LABEL_PX + p.row * ROW_PX }}
                    onClick={() => openItem(p.entry.itemId)}
                  >
                    {p.entry.label}
                  </button>
                ))}
              </div>
            );
          })}
          {today >= win.from && today <= win.to && <div className="timeline-now" style={{ left: x(today) }} title="The current date" />}
        </div>
      </div>
    </section>
  );
}
