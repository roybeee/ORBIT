'use client';
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react';
import { Search, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import type { WorkspaceData } from '@/lib/orbit/model';
import { normalize } from '@/lib/orbit/classify';
import { buildGraph, layoutGraph, type GraphNode, type GraphRef } from '@/lib/orbit/graph';
// Connection graph screen: the SVG is panned and zoomed by hand; hovering isolates a node's links.
export type { GraphRef } from '@/lib/orbit/graph';
export function GraphView({ data, onOpen }: { data: WorkspaceData; onOpen: (ref: GraphRef) => void }) {
  const [showNotes, setShowNotes] = useState(false),
    [showDone, setShowDone] = useState(false),
    [showGoals, setShowGoals] = useState(true),
    [showKeywords, setShowKeywords] = useState(true),
    [query, setQuery] = useState(''),
    [focus, setFocus] = useState<string | null>(null),
    [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const graph = useMemo(
    () => buildGraph(data, { notes: showNotes, done: showDone, goals: showGoals, keywords: showKeywords }),
    [data, showNotes, showDone, showGoals, showKeywords],
  );
  const placed = useMemo(() => layoutGraph(graph.nodes, graph.edges), [graph]);
  const bounds = useMemo(() => {
    if (!placed.length) return { minX: -200, minY: -200, w: 400, h: 400 };
    const xs = placed.map((n) => n.x),
      ys = placed.map((n) => n.y);
    const minX = Math.min(...xs) - 90,
      minY = Math.min(...ys) - 60;
    return { minX, minY, w: Math.max(...xs) - minX + 90, h: Math.max(...ys) - minY + 70 };
  }, [placed]);
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const e of graph.edges) {
      if (!map.has(e.a)) map.set(e.a, new Set());
      if (!map.has(e.b)) map.set(e.b, new Set());
      map.get(e.a)!.add(e.b);
      map.get(e.b)!.add(e.a);
    }
    return map;
  }, [graph]);
  const q = normalize(query);
  const hit = (n: GraphNode) => !!q && normalize(n.label).includes(q);
  const dim = (id: string) =>
    (focus && focus !== id && !neighbours.get(focus)?.has(id)) ||
    (q && !hit(placed.find((n) => n.id === id)!));
  const zoom = (factor: number) => setView((v) => ({ ...v, k: Math.min(4, Math.max(0.4, v.k * factor)) }));
  const onWheel = (e: WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    zoom(e.deltaY < 0 ? 1.12 : 0.9);
  };
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const scale = bounds.w / Math.max(1, (e.currentTarget as SVGSVGElement).clientWidth) / view.k;
    setView((v) => ({
      ...v,
      x: drag.current!.vx + (e.clientX - drag.current!.x) * scale,
      y: drag.current!.vy + (e.clientY - drag.current!.y) * scale,
    }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const cx = bounds.minX + bounds.w / 2,
    cy = bounds.minY + bounds.h / 2;
  return (
    <section className="graph-view" aria-label="연결 그래프">
      <div className="graph-toolbar">
        <label className="search-box">
          <Search size={15} />
          <input
            aria-label="그래프에서 찾기"
            placeholder="프로젝트·할 일·키워드 찾기"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="graph-toggles">
          <label>
            <input
              type="checkbox"
              checked={showKeywords}
              onChange={(e) => setShowKeywords(e.target.checked)}
            />
            키워드 연결
          </label>
          <label>
            <input type="checkbox" checked={showGoals} onChange={(e) => setShowGoals(e.target.checked)} />{' '}
            목표
          </label>
          <label>
            <input type="checkbox" checked={showNotes} onChange={(e) => setShowNotes(e.target.checked)} />{' '}
            기록
          </label>
          <label>
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> 완료
            포함
          </label>
        </div>
        <div className="graph-zoom">
          <button className="icon-button" aria-label="확대" onClick={() => zoom(1.25)}>
            <ZoomIn size={15} />
          </button>
          <button className="icon-button" aria-label="축소" onClick={() => zoom(0.8)}>
            <ZoomOut size={15} />
          </button>
          <button
            className="icon-button"
            aria-label="전체 보기"
            onClick={() => {
              setView({ x: 0, y: 0, k: 1 });
              setFocus(null);
            }}
          >
            <Maximize2 size={15} />
          </button>
        </div>
      </div>
      {placed.length === 0 ? (
        <p className="muted graph-empty">연결할 프로젝트와 할 일이 아직 없습니다.</p>
      ) : (
        <svg
          className="graph-canvas"
          viewBox={`${bounds.minX} ${bounds.minY} ${bounds.w} ${bounds.h}`}
          role="img"
          aria-label="프로젝트와 할 일의 연결"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <g transform={`translate(${cx} ${cy}) scale(${view.k}) translate(${-cx + view.x} ${-cy + view.y})`}>
            {graph.edges.map((e, i) => {
              const a = placed.find((n) => n.id === e.a)!,
                b = placed.find((n) => n.id === e.b)!;
              const faded = dim(e.a) || dim(e.b);
              return (
                <line
                  key={i}
                  className={`graph-edge is-${e.kind} ${faded ? 'is-dim' : ''}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                />
              );
            })}
            {placed.map((n) => (
              <g
                key={n.id}
                className={`graph-node is-${n.kind} ${n.muted ? 'is-muted' : ''} ${dim(n.id) ? 'is-dim' : ''} ${hit(n) ? 'is-hit' : ''} ${focus === n.id ? 'is-focus' : ''}`}
                transform={`translate(${n.x} ${n.y})`}
                onPointerEnter={() => setFocus(n.id)}
                onPointerLeave={() => setFocus(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (n.kind !== 'keyword') onOpen({ kind: n.kind, id: n.refId });
                  else setQuery(n.label);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && n.kind !== 'keyword') onOpen({ kind: n.kind, id: n.refId });
                }}
              >
                <title>{n.label}</title>
                {n.kind === 'goal' ? (
                  <rect x={-n.r} y={-n.r} width={n.r * 2} height={n.r * 2} rx={3} transform="rotate(45)" />
                ) : (
                  <circle r={n.r} style={n.color ? { fill: n.color } : undefined} />
                )}
                <text y={n.r + 12} textAnchor="middle">
                  {n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label}
                </text>
              </g>
            ))}
          </g>
        </svg>
      )}
      <p className="graph-legend">
        <span className="is-project">프로젝트</span>
        <span className="is-task">할 일</span>
        <span className="is-keyword">키워드</span>
        <span className="is-goal">목표</span>
        <span className="is-note">기록</span>
        <span className="muted">노드를 누르면 열립니다 · 휠로 확대, 끌어서 이동</span>
      </p>
    </section>
  );
}
