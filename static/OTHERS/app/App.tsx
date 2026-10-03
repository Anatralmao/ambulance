import { useState, useRef, useEffect } from "react";
import { ChevronDown, Loader2, Navigation, Clock, History, Sun, Moon, Cpu, FlaskConical } from "lucide-react";

/* ─── Types ─── */
type RouteResult = { id: number; travelTime: string; graphKm: string; roadKm: string; via: string; total: string };
type Session = { id: string; timestamp: string; testCase: string; algorithm: string; results: RouteResult[] };

/* ─── Constants ─── */
const TEST_CASES = [
  "— Select test case —",
  "TC-01: Hospital A → Hospital B",
  "TC-02: Station 3 → Emergency Zone 7",
  "TC-03: Downtown HQ → Airport Triage",
  "TC-04: North Grid → South Grid",
  "TC-05: Rush Hour Cross-City",
  "TC-06: Night Shift Route Check",
];

const ALGORITHMS = [
  "— Select algorithm —",
  "Dijkstra's Algorithm",
  "A* Search",
  "Bellman-Ford",
  "BFS (Breadth-First)",
  "DFS (Depth-First)",
  "Floyd-Warshall",
];

const RESULT_COLUMNS = ["#", "Travel Time", "Graph km", "Road km", "Via", "Total"];

const MOCK_RESULTS: RouteResult[] = [
  { id: 1, travelTime: "4m 22s", graphKm: "3.14", roadKm: "3.88", via: "Jl. Sudirman → Tol Semanggi", total: "8.32" },
  { id: 2, travelTime: "5m 07s", graphKm: "3.60", roadKm: "4.21", via: "Jl. Gatot Subroto → Halim", total: "9.41" },
  { id: 3, travelTime: "6m 51s", graphKm: "4.85", roadKm: "5.30", via: "Jl. Rasuna Said → Kuningan", total: "11.75" },
];

const PREFILLED_SESSIONS: Session[] = [
  {
    id: "sess-001", timestamp: "2026-09-30  08:14",
    testCase: "TC-01: Hospital A → Hospital B", algorithm: "Dijkstra's Algorithm",
    results: [
      { id: 1, travelTime: "3m 50s", graphKm: "2.90", roadKm: "3.40", via: "Jl. Thamrin → Bundaran HI", total: "7.10" },
      { id: 2, travelTime: "4m 30s", graphKm: "3.20", roadKm: "3.80", via: "Jl. Sudirman → Semanggi", total: "8.00" },
    ],
  },
  {
    id: "sess-002", timestamp: "2026-09-30  11:47",
    testCase: "TC-03: Downtown HQ → Airport Triage", algorithm: "A* Search",
    results: [
      { id: 1, travelTime: "12m 10s", graphKm: "9.80", roadKm: "11.20", via: "Tol Cikampek → Soekarno-Hatta", total: "22.40" },
      { id: 2, travelTime: "14m 05s", graphKm: "11.00", roadKm: "12.50", via: "Jl. Daan Mogot → Bandara", total: "25.10" },
    ],
  },
  {
    id: "sess-003", timestamp: "2026-09-30  14:02",
    testCase: "TC-05: Rush Hour Cross-City", algorithm: "Bellman-Ford",
    results: [
      { id: 1, travelTime: "22m 18s", graphKm: "15.40", roadKm: "17.60", via: "Tol Jagorawi → Cawang", total: "35.20" },
    ],
  },
  {
    id: "sess-004", timestamp: "2026-09-30  17:30",
    testCase: "TC-02: Station 3 → Emergency Zone 7", algorithm: "BFS (Breadth-First)",
    results: [
      { id: 1, travelTime: "6m 44s", graphKm: "4.60", roadKm: "5.10", via: "Jl. Antasari → Fatmawati", total: "10.40" },
      { id: 2, travelTime: "7m 55s", graphKm: "5.30", roadKm: "6.00", via: "Jl. TB Simatupang → Lenteng Agung", total: "12.10" },
    ],
  },
];

/* ─── Theme tokens ─── */
const T = {
  dark: {
    mapBg: "#080e1a",
    mapGround: "#080e1a",
    mapBlock: "#0c1a2a",
    mapMinorRoad: "#0e2540",
    mapMajorRoad: "#12304e",
    mapHighway: "#0f2d48",
    mapWater: "#071929",
    mapPark: "#0a1e12",
    panelBg: "rgba(10,18,32,0.85)",
    panelBorder: "rgba(100,160,220,0.18)",
    panelShadow: "0 4px 24px rgba(0,0,0,0.5)",
    panelBlur: "blur(12px)",
    text: "#c5d4e8",
    label: "#4a6a8a",
    muted: "#5a7494",
    dimmed: "#2e4e6a",
    selectBg: "rgba(10,18,32,0.82)",
    dropBg: "rgba(9,16,28,0.97)",
    dropBorder: "rgba(100,160,220,0.18)",
    rowSep: "rgba(100,160,220,0.08)",
    rowHover: "rgba(255,255,255,0.03)",
    toggleIcon: <Sun size={14} />,
    toggleLabel: "Light",
    attribution: "#1e3a55",
    scaleBar: "#3d5a78",
  },
  light: {
    mapBg: "#e8e4d8",
    mapGround: "#e8e4d8",
    mapBlock: "#d0ccbf",
    mapMinorRoad: "#f0ece4",
    mapMajorRoad: "#faf6ee",
    mapHighway: "#ddd4c4",
    mapWater: "#b8d0e4",
    mapPark: "#c4d8b4",
    panelBg: "rgba(250,252,255,0.92)",
    panelBorder: "rgba(40,80,160,0.18)",
    panelShadow: "0 4px 24px rgba(0,0,0,0.12)",
    panelBlur: "blur(14px)",
    text: "#1a2d42",
    label: "#5a7a9a",
    muted: "#6a8aaa",
    dimmed: "#9ab0c8",
    selectBg: "rgba(250,252,255,0.9)",
    dropBg: "rgba(248,251,255,0.99)",
    dropBorder: "rgba(40,80,160,0.15)",
    rowSep: "rgba(40,80,160,0.08)",
    rowHover: "rgba(0,0,0,0.02)",
    toggleIcon: <Moon size={14} />,
    toggleLabel: "Dark",
    attribution: "#8098b0",
    scaleBar: "#8098b0",
  },
} as const;

type Theme = "dark" | "light";

/* ─── Map ─── */
function FullScreenMap({ theme }: { theme: Theme }) {
  const t = T[theme];
  return (
    <div className="absolute inset-0 w-full h-full" style={{ background: t.mapBg }}>
      <svg width="100%" height="100%" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="glow-a" cx="22%" cy="80%" r="25%">
            <stop offset="0%" stopColor="#16a34a" stopOpacity={theme === "dark" ? 0.15 : 0.25} />
            <stop offset="100%" stopColor="#16a34a" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="glow-b" cx="78%" cy="18%" r="22%">
            <stop offset="0%" stopColor="#dc2626" stopOpacity={theme === "dark" ? 0.18 : 0.2} />
            <stop offset="100%" stopColor="#dc2626" stopOpacity="0" />
          </radialGradient>
          <filter id="blur-route"><feGaussianBlur stdDeviation="4" /></filter>
        </defs>
        <rect width="1440" height="900" fill={t.mapGround} />
        {/* water */}
        <ellipse cx="1300" cy="820" rx="220" ry="130" fill={t.mapWater} />
        <ellipse cx="1250" cy="850" rx="150" ry="90" fill={t.mapWater} />
        <ellipse cx="60" cy="60" rx="120" ry="80" fill={t.mapWater} />
        {/* parks */}
        <rect x="580" y="380" width="90" height="60" rx="4" fill={t.mapPark} />
        <rect x="900" y="540" width="70" height="50" rx="4" fill={t.mapPark} />
        <rect x="140" y="300" width="80" height="55" rx="4" fill={t.mapPark} />
        <rect x="1100" y="600" width="100" height="65" rx="4" fill={t.mapPark} />
        {/* city blocks */}
        {([
          [100,120,130,80],[260,110,100,90],[400,100,120,75],[560,90,110,85],
          [720,80,130,90],[900,100,110,80],[1050,90,120,80],[1210,110,100,75],
          [100,250,80,100],[210,240,140,110],[390,240,90,100],[520,250,130,90],
          [700,230,80,110],[820,240,120,100],[990,250,80,100],[1100,235,130,105],
          [80,400,120,80],[240,395,90,85],[370,400,100,80],[510,410,85,75],
          [680,400,130,80],[860,395,100,85],[1000,400,120,80],[1160,410,90,75],
          [80,530,140,75],[260,525,100,80],[400,530,110,75],[560,540,90,70],
          [700,530,120,75],[870,525,100,80],[1030,530,130,75],[1190,540,100,70],
          [100,660,120,70],[250,655,90,75],[380,660,110,70],[530,665,80,65],
          [660,655,130,70],[840,660,100,70],[1010,655,110,70],[1170,660,90,70],
        ] as number[][]).map(([x,y,w,h], i) => <rect key={i} x={x} y={y} width={w} height={h} rx="2" fill={t.mapBlock} />)}
        {/* minor roads */}
        {[100,200,310,420,500,600,700,780,860].map((y) => <line key={y} x1="0" y1={y} x2="1440" y2={y} stroke={t.mapMinorRoad} strokeWidth="1.5" />)}
        {[120,240,360,480,600,720,840,960,1080,1200,1320].map((x) => <line key={x} x1={x} y1="0" x2={x} y2="900" stroke={t.mapMinorRoad} strokeWidth="1.5" />)}
        {/* major arterials */}
        <line x1="0" y1="360" x2="1440" y2="360" stroke={t.mapMajorRoad} strokeWidth="4" />
        <line x1="0" y1="600" x2="1440" y2="600" stroke={t.mapMajorRoad} strokeWidth="4" />
        <line x1="0" y1="160" x2="1440" y2="160" stroke={t.mapMajorRoad} strokeWidth="3" />
        <line x1="440" y1="0" x2="440" y2="900" stroke={t.mapMajorRoad} strokeWidth="4" />
        <line x1="900" y1="0" x2="900" y2="900" stroke={t.mapMajorRoad} strokeWidth="4" />
        <line x1="1200" y1="0" x2="1200" y2="900" stroke={t.mapMajorRoad} strokeWidth="3" />
        {/* highway */}
        <line x1="0" y1="820" x2="1440" y2="80" stroke={t.mapHighway} strokeWidth="8" opacity="0.9" />
        <line x1="0" y1="850" x2="1440" y2="110" stroke={t.mapHighway} strokeWidth="8" opacity="0.9" />
        {/* pin glows */}
        <ellipse cx="320" cy="720" rx="220" ry="200" fill="url(#glow-a)" />
        <ellipse cx="1120" cy="160" rx="200" ry="180" fill="url(#glow-b)" />
        {/* route glow */}
        <polyline points="320,720 360,600 440,500 520,420 620,360 720,290 840,220 960,175 1060,160 1140,155" fill="none" stroke="#dc2626" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" opacity="0.18" filter="url(#blur-route)" />
        {/* route crisp */}
        <polyline points="320,720 360,600 440,500 520,420 620,360 720,290 840,220 960,175 1060,160 1140,155" fill="none" stroke="#dc2626" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
        {/* sensors */}
        {([[440,500],[620,360],[840,220],[960,175]] as number[][]).map(([cx,cy],i) => <circle key={i} cx={cx} cy={cy} r="4" fill="#0ea5e9" opacity="0.8" stroke={theme === "dark" ? "#070c14" : "#ffffff"} strokeWidth="1.5" />)}
        {/* pins */}
        <circle cx="320" cy="720" r="16" fill="#16a34a" stroke={theme === "dark" ? "#070c14" : "#ffffff"} strokeWidth="2.5" />
        <text x="320" y="725" textAnchor="middle" fill="white" fontSize="12" fontWeight="800" fontFamily="sans-serif">A</text>
        <circle cx="1140" cy="155" r="16" fill="#dc2626" stroke={theme === "dark" ? "#070c14" : "#ffffff"} strokeWidth="2.5" />
        <text x="1140" y="160" textAnchor="middle" fill="white" fontSize="12" fontWeight="800" fontFamily="sans-serif">B</text>
        {/* zoom controls */}
        <rect x="24" y="380" width="34" height="34" rx="4" fill={theme === "dark" ? "#0c1a2a" : "rgba(255,255,255,0.9)"} stroke={theme === "dark" ? "rgba(100,160,220,0.18)" : "rgba(40,80,160,0.2)"} strokeWidth="1" />
        <text x="41" y="402" textAnchor="middle" fill={theme === "dark" ? "#94adc8" : "#4a6a9a"} fontSize="20" fontFamily="sans-serif">+</text>
        <rect x="24" y="418" width="34" height="34" rx="4" fill={theme === "dark" ? "#0c1a2a" : "rgba(255,255,255,0.9)"} stroke={theme === "dark" ? "rgba(100,160,220,0.18)" : "rgba(40,80,160,0.2)"} strokeWidth="1" />
        <text x="41" y="440" textAnchor="middle" fill={theme === "dark" ? "#94adc8" : "#4a6a9a"} fontSize="20" fontFamily="sans-serif">−</text>
        {/* scale */}
        <line x1="1340" y1="870" x2="1420" y2="870" stroke={t.scaleBar} strokeWidth="1.5" />
        <line x1="1340" y1="865" x2="1340" y2="875" stroke={t.scaleBar} strokeWidth="1.5" />
        <line x1="1420" y1="865" x2="1420" y2="875" stroke={t.scaleBar} strokeWidth="1.5" />
        <text x="1380" y="886" textAnchor="middle" fill={t.scaleBar} fontSize="10" fontFamily="monospace">1 km</text>
        <text x="1435" y="895" textAnchor="end" fill={t.attribution} fontSize="9" fontFamily="sans-serif">© OpenStreetMap contributors</text>
      </svg>
    </div>
  );
}

/* ─── Dropdown select ─── */
function Dropdown({ value, onChange, options, label, theme }: {
  value: string; onChange: (v: string) => void; options: string[]; label: string; theme: Theme;
}) {
  const t = T[theme];
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[9px] font-semibold tracking-widest uppercase pl-1" style={{ color: t.label, fontFamily: "'JetBrains Mono', monospace" }}>
        {label}
      </label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="appearance-none rounded-lg px-3 py-2.5 pr-8 focus:outline-none"
          style={{
            background: t.selectBg,
            border: `1px solid ${t.panelBorder}`,
            color: t.text,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "11px",
            backdropFilter: t.panelBlur,
            WebkitBackdropFilter: t.panelBlur,
            minWidth: 240,
            boxShadow: t.panelShadow,
          }}
        >
          {options.map((o) => <option key={o} value={o} style={{ background: theme === "dark" ? "#0a1220" : "#f8fbff", color: t.text }}>{o}</option>)}
        </select>
        <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" style={{ color: t.muted }} />
      </div>
    </div>
  );
}

/* ─── Session recordings dropdown ─── */
function SessionDropdown({ sessions, theme, onClose }: { sessions: Session[]; theme: Theme; onClose: () => void }) {
  const t = T[theme];
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const sorted = [...sessions].reverse();

  return (
    <div
      ref={ref}
      className="absolute top-full mt-1.5 left-0 rounded-xl overflow-hidden"
      style={{
        width: 320,
        maxHeight: 300,
        background: t.dropBg,
        border: `1px solid ${t.dropBorder}`,
        backdropFilter: t.panelBlur,
        WebkitBackdropFilter: t.panelBlur,
        boxShadow: theme === "dark" ? "0 12px 40px rgba(0,0,0,0.7)" : "0 12px 40px rgba(0,0,0,0.15)",
        overflowY: "auto",
        zIndex: 50,
      }}
    >
      {/* header */}
      <div
        className="sticky top-0 px-3 py-2 flex items-center justify-between border-b"
        style={{
          background: theme === "dark" ? "rgba(6,12,22,0.95)" : "rgba(240,245,255,0.98)",
          borderColor: t.rowSep,
          backdropFilter: "blur(8px)",
        }}
      >
        <span className="text-[9px] font-bold tracking-widest uppercase" style={{ color: t.label, fontFamily: "'JetBrains Mono', monospace" }}>
          Session Recordings
        </span>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(220,38,38,0.12)", color: "#dc2626", border: "1px solid rgba(220,38,38,0.2)" }}>
          {sessions.length}
        </span>
      </div>

      {sorted.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-[10px]" style={{ color: t.dimmed, fontFamily: "'JetBrains Mono', monospace" }}>
          No sessions yet
        </div>
      ) : (
        sorted.map((session, idx) => (
          <div
            key={session.id}
            className="flex items-center gap-2.5 px-3 py-2.5 transition-colors"
            style={{
              borderTop: idx > 0 ? `1px solid ${t.rowSep}` : "none",
              cursor: "default",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = t.rowHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            {/* index */}
            <span
              className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-[8px] font-bold"
              style={{ background: "rgba(220,38,38,0.12)", color: "#dc2626", border: "1px solid rgba(220,38,38,0.2)", fontFamily: "'JetBrains Mono', monospace" }}
            >
              {sessions.length - idx}
            </span>

            {/* content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <FlaskConical size={8} style={{ color: t.muted, flexShrink: 0 }} />
                <span className="text-[10px] truncate" style={{ color: t.text, fontFamily: "'JetBrains Mono', monospace" }}>
                  {session.testCase.replace(/^TC-\d+:\s*/, "")}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <div className="flex items-center gap-1">
                  <Cpu size={8} style={{ color: t.muted }} />
                  <span className="text-[9px]" style={{ color: t.muted, fontFamily: "'JetBrains Mono', monospace" }}>{session.algorithm}</span>
                </div>
                <span className="text-[9px]" style={{ color: t.dimmed, fontFamily: "'JetBrains Mono', monospace" }}>·</span>
                <span className="text-[9px]" style={{ color: t.dimmed, fontFamily: "'JetBrains Mono', monospace" }}>{session.timestamp}</span>
              </div>
            </div>

            {/* route count */}
            <span className="shrink-0 text-[9px]" style={{ color: t.dimmed, fontFamily: "'JetBrains Mono', monospace" }}>
              {session.results.length}R
            </span>
          </div>
        ))
      )}
    </div>
  );
}

/* ─── Live results drawer ─── */
function ResultsDrawer({ results, theme }: { results: RouteResult[]; theme: Theme }) {
  const t = T[theme];
  if (results.length === 0) return null;
  return (
    <div
      className="absolute bottom-28 left-1/2 -translate-x-1/2 rounded-xl overflow-hidden"
      style={{
        background: t.dropBg,
        border: `1px solid ${t.dropBorder}`,
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        boxShadow: theme === "dark" ? "0 8px 40px rgba(0,0,0,0.6)" : "0 8px 40px rgba(0,0,0,0.15)",
        minWidth: 680,
        maxWidth: "90vw",
      }}
    >
      <div className="grid text-[9px] font-semibold tracking-widest uppercase border-b" style={{ gridTemplateColumns: "2rem 1fr 1fr 1fr 2.5fr 1fr", borderColor: t.rowSep, background: theme === "dark" ? "rgba(8,14,26,0.7)" : "rgba(230,240,255,0.7)", fontFamily: "'JetBrains Mono', monospace", color: t.dimmed }}>
        {RESULT_COLUMNS.map((col) => <div key={col} className="px-3 py-2">{col}</div>)}
      </div>
      {results.map((row, idx) => (
        <div key={row.id} className="grid text-xs" style={{ gridTemplateColumns: "2rem 1fr 1fr 1fr 2.5fr 1fr", borderTop: idx > 0 ? `1px solid ${t.rowSep}` : "none", fontFamily: "'JetBrains Mono', monospace", color: t.muted }}>
          <div className="px-3 py-2.5" style={{ color: "#dc2626" }}>{row.id}</div>
          <div className="px-3 py-2.5 flex items-center gap-1.5"><Clock size={10} style={{ color: t.muted }} />{row.travelTime}</div>
          <div className="px-3 py-2.5">{row.graphKm} km</div>
          <div className="px-3 py-2.5">{row.roadKm} km</div>
          <div className="px-3 py-2.5 truncate" style={{ color: t.text }}>{row.via}</div>
          <div className="px-3 py-2.5" style={{ color: "#0ea5e9" }}>{row.total} km</div>
        </div>
      ))}
    </div>
  );
}

/* ─── App ─── */
export default function App() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [testCase, setTestCase] = useState(TEST_CASES[0]);
  const [algorithm, setAlgorithm] = useState(ALGORITHMS[0]);
  const [status, setStatus] = useState<"idle" | "running" | "done">("idle");
  const [results, setResults] = useState<RouteResult[]>([]);
  const [sessions, setSessions] = useState<Session[]>(PREFILLED_SESSIONS);
  const [sessionOpen, setSessionOpen] = useState(false);

  const t = T[theme];

  const handleFindRoute = () => {
    if (status === "running") return;
    setStatus("running");
    setResults([]);
    setSessionOpen(false);
    setTimeout(() => {
      setStatus("done");
      setResults(MOCK_RESULTS);
      setSessions((prev) => [
        ...prev,
        {
          id: `sess-${Date.now()}`,
          timestamp: new Date().toISOString().replace("T", "  ").slice(0, 16),
          testCase: testCase === TEST_CASES[0] ? "TC-01: Hospital A → Hospital B" : testCase,
          algorithm: algorithm === ALGORITHMS[0] ? "Dijkstra's Algorithm" : algorithm,
          results: MOCK_RESULTS,
        },
      ]);
    }, 1800);
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

        .find-route-btn {
          transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.35s ease;
        }
        .find-route-btn:hover:not(:disabled) {
          transform: scale(1.12);
          box-shadow: 0 0 48px rgba(220,38,38,0.55), 0 8px 32px rgba(0,0,0,0.4);
        }
        .find-route-btn:not(:hover) { transform: scale(1); }
        .find-route-btn:active:not(:disabled) { transform: scale(0.97); }

        .theme-btn {
          transition: background 0.2s ease, transform 0.15s ease;
        }
        .theme-btn:hover { transform: scale(1.05); }
        .theme-btn:active { transform: scale(0.95); }

        .history-btn { transition: background 0.2s ease, border-color 0.2s ease; }

        select option { background: #0a1220; }

        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e3a55; border-radius: 2px; }
      `}</style>

      <div className="relative w-full h-full overflow-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>

        {/* ── Map background ── */}
        <FullScreenMap theme={theme} />

        {/* ── Top-left controls ── */}
        <div className="absolute top-5 left-5 z-20 flex flex-col gap-3" style={{ position: "absolute" }}>
          <Dropdown label="Test Case" value={testCase} onChange={setTestCase} options={TEST_CASES} theme={theme} />
          <Dropdown label="Search Algorithm" value={algorithm} onChange={setAlgorithm} options={ALGORITHMS} theme={theme} />

          {/* Session Recordings trigger + dropdown */}
          <div className="relative">
            <button
              onClick={() => setSessionOpen((v) => !v)}
              className="history-btn flex items-center gap-2 rounded-lg px-3 py-2.5 w-full"
              style={{
                background: sessionOpen
                  ? (theme === "dark" ? "rgba(14,165,233,0.12)" : "rgba(14,165,233,0.1)")
                  : t.panelBg,
                border: `1px solid ${sessionOpen ? "rgba(14,165,233,0.3)" : t.panelBorder}`,
                color: sessionOpen ? "#0ea5e9" : t.muted,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "11px",
                backdropFilter: t.panelBlur,
                WebkitBackdropFilter: t.panelBlur,
                boxShadow: t.panelShadow,
                cursor: "pointer",
                minWidth: 240,
              }}
            >
              <History size={12} />
              <span>Session Recordings</span>
              {sessions.length > 0 && (
                <span
                  className="ml-auto px-1.5 py-0.5 rounded-full text-[9px] font-bold"
                  style={{ background: "rgba(220,38,38,0.15)", color: "#dc2626", border: "1px solid rgba(220,38,38,0.2)" }}
                >
                  {sessions.length}
                </span>
              )}
              <ChevronDown
                size={11}
                style={{
                  color: t.muted,
                  transform: sessionOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s ease",
                  marginLeft: sessions.length > 0 ? 0 : "auto",
                }}
              />
            </button>

            {sessionOpen && (
              <SessionDropdown sessions={sessions} theme={theme} onClose={() => setSessionOpen(false)} />
            )}
          </div>
        </div>

        {/* ── Top-right: theme toggle + AMBUFIND logo ── */}
        <div className="absolute top-5 right-5 z-20 flex flex-col items-end gap-3">
          <button
            onClick={() => setTheme((v) => (v === "dark" ? "light" : "dark"))}
            className="theme-btn flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold"
            style={{
              background: t.panelBg,
              border: `1px solid ${t.panelBorder}`,
              color: t.text,
              backdropFilter: t.panelBlur,
              WebkitBackdropFilter: t.panelBlur,
              boxShadow: t.panelShadow,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "11px",
              cursor: "pointer",
            }}
          >
            {t.toggleIcon}
            <span>{t.toggleLabel} mode</span>
          </button>
        </div>

        {/* ── AMBUFIND watermark logo (rotated) ── */}
        <div
          className="absolute z-10 pointer-events-none"
          style={{
            top: "50%",
            right: 0,
            transform: "translateX(calc(50% - 20px)) translateY(-50%) rotate(90deg)",
            transformOrigin: "center center",
          }}
        >
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "13px",
            fontWeight: 700,
            letterSpacing: "0.35em",
            color: theme === "dark" ? "rgba(197,212,232,0.3)" : "rgba(30,60,100,0.2)",
            textTransform: "uppercase",
            userSelect: "none",
            whiteSpace: "nowrap",
          }}>
            AMBU<span style={{ color: theme === "dark" ? "rgba(220,38,38,0.5)" : "rgba(220,38,38,0.4)" }}>FIND</span>
          </span>
        </div>

        {/* ── Live results ── */}
        <ResultsDrawer results={results} theme={theme} />

        {/* ── Bottom-center: Find Route ── */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-3">
          {status !== "idle" && (
            <div
              className="flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-semibold"
              style={{
                background: t.panelBg,
                border: `1px solid ${t.panelBorder}`,
                backdropFilter: "blur(10px)",
                fontFamily: "'JetBrains Mono', monospace",
                color: status === "running" ? "#f59e0b" : "#16a34a",
                letterSpacing: "0.1em",
              }}
            >
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: status === "running" ? "#f59e0b" : "#16a34a", boxShadow: `0 0 5px ${status === "running" ? "#f59e0b" : "#16a34a"}` }} />
              {status === "running" ? "COMPUTING ROUTE..." : "ROUTE FOUND"}
            </div>
          )}

          <button
            onClick={handleFindRoute}
            disabled={status === "running"}
            className="find-route-btn flex items-center gap-3 rounded-2xl font-bold"
            style={{
              background: status === "running" ? "rgba(127,29,29,0.85)" : "rgba(220,38,38,0.92)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              color: "#ffffff",
              border: "1px solid rgba(255,100,100,0.3)",
              padding: "16px 44px",
              fontSize: "17px",
              letterSpacing: "0.04em",
              cursor: status === "running" ? "not-allowed" : "pointer",
              boxShadow: "0 0 28px rgba(220,38,38,0.35), 0 8px 32px rgba(0,0,0,0.4)",
              fontFamily: "'Inter', sans-serif",
            }}
          >
            {status === "running"
              ? <><Loader2 size={20} className="animate-spin" />Computing…</>
              : <><Navigation size={20} />Find Route</>}
          </button>
        </div>

      </div>
    </>
  );
}
