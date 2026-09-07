import type { WorkspaceData } from './model.ts';
import { keywordLinks, normalize } from './classify.ts';
// Connection graph model: projects are hubs, tasks/notes/goals hang off them and keywords make the
// 안분 visible as project ↔ keyword ↔ task chains. The layout is a small deterministic force
// simulation run once per data change (pure, so the same data always draws the same picture).
export type GraphRef = { kind: 'project' | 'task' | 'note' | 'goal' | 'keyword'; id: string };
export interface GraphNode {
  id: string;
  kind: GraphRef['kind'];
  refId: string;
  projectId?: string;
  recordKind?: 'note'|'task'|'event';
  label: string;
  r: number;
  color?: string;
  muted?: boolean;
}
export interface GraphEdge {
  a: string;
  b: string;
  kind: 'member' | 'keyword' | 'goal' | 'depends' | 'note';
}
interface Point {
  x: number;
  y: number;
  vx: number;
  vy: number;
}
const LENGTH: Record<GraphEdge['kind'], number> = {
  member: 80,
  keyword: 55,
  goal: 130,
  depends: 70,
  note: 65,
};
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[], iterations = 320) {
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const hubs = nodes.filter((n) => n.kind === 'project' || n.kind === 'goal');
  const pts: Point[] = nodes.map((n, i) => {
    // Hubs on a ring, everything else close to its first hub so the simulation starts untangled.
    const hubIndex = hubs.indexOf(n);
    if (hubIndex >= 0) {
      const angle = (hubIndex / Math.max(1, hubs.length)) * Math.PI * 2;
      return { x: Math.cos(angle) * 180, y: Math.sin(angle) * 180, vx: 0, vy: 0 };
    }
    const link = edges.find((e) => e.a === n.id || e.b === n.id);
    const other = link ? nodes[index.get(link.a === n.id ? link.b : link.a)!] : undefined;
    const base = other && hubs.includes(other) ? hubs.indexOf(other) : i;
    const angle = (base / Math.max(1, hubs.length)) * Math.PI * 2 + (i % 7) * 0.9;
    const radius = other && hubs.includes(other) ? 180 : 120;
    return {
      x: Math.cos(angle) * radius + (i % 5) * 9,
      y: Math.sin(angle) * radius + (i % 3) * 9,
      vx: 0,
      vy: 0,
    };
  });
  const links = edges
    .map((e) => ({ a: index.get(e.a), b: index.get(e.b), length: LENGTH[e.kind] }))
    .filter((l): l is { a: number; b: number; length: number } => l.a !== undefined && l.b !== undefined);
  for (let step = 0; step < iterations; step++) {
    const cool = 1 - step / iterations;
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        let dx = pts[i].x - pts[j].x,
          dy = pts[i].y - pts[j].y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = (i - j) * 0.5;
          dy = 0.5;
          d2 = 0.5;
        }
        const force = (900 * (nodes[i].r + nodes[j].r)) / (d2 * 2);
        const fx = (dx / Math.sqrt(d2)) * force,
          fy = (dy / Math.sqrt(d2)) * force;
        pts[i].vx += fx;
        pts[i].vy += fy;
        pts[j].vx -= fx;
        pts[j].vy -= fy;
      }
    for (const l of links) {
      const dx = pts[l.b].x - pts[l.a].x,
        dy = pts[l.b].y - pts[l.a].y;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const pull = (d - l.length) * 0.02;
      const fx = (dx / d) * pull,
        fy = (dy / d) * pull;
      pts[l.a].vx += fx;
      pts[l.a].vy += fy;
      pts[l.b].vx -= fx;
      pts[l.b].vy -= fy;
    }
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      p.vx += -p.x * 0.004;
      p.vy += -p.y * 0.004;
      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      const cap = 6 * cool + 0.5;
      if (speed > cap) {
        p.vx = (p.vx / speed) * cap;
        p.vy = (p.vy / speed) * cap;
      }
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.82;
      p.vy *= 0.82;
    }
  }
  return nodes.map((n, i) => ({ ...n, x: pts[i].x, y: pts[i].y }));
}
export function buildGraph(
  data: WorkspaceData,
  options: { notes: boolean; done: boolean; goals: boolean; keywords: boolean; projectId?: string },
) {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const projects = data.projects.filter((p) => !options.projectId || p.id === options.projectId);
  const tasks = connectedTasks(data, { projectId: options.projectId, done: options.done });
  const notes = data.notes.filter((n) => !options.projectId || n.projectId === options.projectId);
  const goalIds = new Set(projects.map((p) => p.goalId));
  // Include ancestors of the selected project's goal without unrelated goal branches.
  for (let i = 0; i < (data.goals ?? []).length; i++)
    for (const g of data.goals ?? []) if (goalIds.has(g.id) && g.parentId) goalIds.add(g.parentId);
  for (const p of projects) {
    const count = data.tasks.filter((t) => t.projectId === p.id).length;
    nodes.push({
      id: 'project:' + p.id,
      kind: 'project',
      refId: p.id,
      label: p.name,
      r: Math.min(24, 11 + count * 1.4),
      color: p.color,
    });
    if (options.goals && p.goalId) edges.push({ a: 'goal:' + p.goalId, b: 'project:' + p.id, kind: 'goal' });
  }
  if (options.goals)
    for (const g of (data.goals ?? []).filter((g) => !options.projectId || goalIds.has(g.id))) {
      nodes.push({ id: 'goal:' + g.id, kind: 'goal', refId: g.id, label: g.sentence, r: 9 });
      if (g.parentId) edges.push({ a: 'goal:' + g.parentId, b: 'goal:' + g.id, kind: 'goal' });
    }
  for (const t of tasks) {
    nodes.push({
      id: 'task:' + t.id,
      kind: 'task',
      refId: t.id,
      label: t.title,
      r: t.laserDate ? 7 : 5,
      muted: t.status === 'done',
    });
    edges.push({ a: 'project:' + t.projectId, b: 'task:' + t.id, kind: 'member' });
    for (const dep of t.dependsOn ?? [])
      if (tasks.some((x) => x.id === dep))
        edges.push({ a: 'task:' + dep, b: 'task:' + t.id, kind: 'depends' });
    if (options.notes && t.noteId && data.notes.some((n) => n.id === t.noteId))
      edges.push({ a: 'note:' + t.noteId, b: 'task:' + t.id, kind: 'note' });
  }
  if (options.notes)
    for (const n of notes) {
      nodes.push({ id: 'note:' + n.id, kind: 'note', refId: n.id, label: n.title, r: 4 });
      edges.push({ a: 'project:' + n.projectId, b: 'note:' + n.id, kind: 'member' });
    }
  if (options.keywords)
    for (const p of projects)
      for (const link of keywordLinks(p, tasks.filter((t) => t.projectId === p.id))) {
        const id = `keyword:${p.id}:${link.keyword}`;
        nodes.push({ id, kind: 'keyword', refId: link.keyword, projectId: p.id, label: link.keyword, r: 3.5 });
        edges.push({ a: 'project:' + p.id, b: id, kind: 'keyword' });
        for (const taskId of link.taskIds) edges.push({ a: id, b: 'task:' + taskId, kind: 'keyword' });
      }
  // Drop edges whose ends are filtered out (done tasks, hidden goals).
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: edges.filter((e) => ids.has(e.a) && ids.has(e.b)) };
}

// The graph and its accessible list share exactly the same project/status/keyword filters.
export function connectedTasks(data: WorkspaceData, options: { projectId?: string; keyword?: string; done: boolean; query?: string }) {
  return data.tasks.filter((t) =>
    (!options.projectId || t.projectId === options.projectId) &&
    (options.done || t.status !== 'done') &&
    (!options.keyword || normalize(`${t.title} ${t.definition}`).includes(normalize(options.keyword))) &&
    (!options.query || normalize(`${t.title} ${t.definition} ${data.projects.find((p) => p.id === t.projectId)?.name ?? ''}`).includes(normalize(options.query)))
  );
}
