// ============================================================
// navigation.js — 轻量二维网格 A* 导航
// 地图生成后根据 colliders 建立可行走网格，供敌人和友军共用。
// ============================================================
import * as THREE from 'three';

class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(node) {
    const a = this.items;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= node.f) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = node;
  }
  pop() {
    const a = this.items;
    if (!a.length) return null;
    const root = a[0];
    const last = a.pop();
    if (a.length && last) {
      let i = 0;
      while (true) {
        const l = i * 2 + 1;
        if (l >= a.length) break;
        const r = l + 1;
        const c = r < a.length && a[r].f < a[l].f ? r : l;
        if (a[c].f >= last.f) break;
        a[i] = a[c];
        i = c;
      }
      a[i] = last;
    }
    return root;
  }
}

export class GridNavigator {
  constructor(map, cellSize = 3, agentRadius = 0.42) {
    this.map = map;
    this.cellSize = cellSize;
    this.agentRadius = agentRadius;
    const [minX, maxX, minZ, maxZ] = map.bounds;
    this.minX = minX;
    this.minZ = minZ;
    this.width = Math.max(1, Math.ceil((maxX - minX) / cellSize));
    this.height = Math.max(1, Math.ceil((maxZ - minZ) / cellSize));
    this.blocked = new Uint8Array(this.width * this.height);
    this._build();
  }

  _idx(x, z) { return z * this.width + x; }
  _inside(x, z) { return x >= 0 && z >= 0 && x < this.width && z < this.height; }
  _walkable(x, z) { return this._inside(x, z) && this.blocked[this._idx(x, z)] === 0; }

  _build() {
    const r = this.agentRadius;
    const cs = this.cellSize;
    for (let z = 0; z < this.height; z++) {
      for (let x = 0; x < this.width; x++) {
        const wx = this.minX + (x + 0.5) * cs;
        const wz = this.minZ + (z + 0.5) * cs;
        const ground = this.map.groundHeight(wx, wz);
        let blocked = false;
        for (const b of this.map.colliders) {
          // 很薄的地面装饰不阻挡步兵；其他碰撞体按角色半径扩张。
          if (b.h < 0.45) continue;
          const vertical = Math.abs((ground + 0.8) - b.y) < b.h / 2 + 0.8;
          if (!vertical) continue;
          if (Math.abs(wx - b.x) < b.w / 2 + r && Math.abs(wz - b.z) < b.d / 2 + r) {
            blocked = true;
            break;
          }
        }
        this.blocked[this._idx(x, z)] = blocked ? 1 : 0;
      }
    }
  }

  worldToCell(pos) {
    return {
      x: Math.floor((pos.x - this.minX) / this.cellSize),
      z: Math.floor((pos.z - this.minZ) / this.cellSize),
    };
  }

  cellToWorld(x, z) {
    const wx = this.minX + (x + 0.5) * this.cellSize;
    const wz = this.minZ + (z + 0.5) * this.cellSize;
    return new THREE.Vector3(wx, this.map.groundHeight(wx, wz), wz);
  }

  nearestWalkable(cell, maxRadius = 8) {
    if (this._walkable(cell.x, cell.z)) return cell;
    for (let r = 1; r <= maxRadius; r++) {
      let best = null;
      let bestD = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const x = cell.x + dx, z = cell.z + dz;
          if (!this._walkable(x, z)) continue;
          const d = dx * dx + dz * dz;
          if (d < bestD) { bestD = d; best = { x, z }; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  lineClear(a, b) {
    const ac = this.worldToCell(a);
    const bc = this.worldToCell(b);
    let x0 = ac.x, z0 = ac.z;
    const x1 = bc.x, z1 = bc.z;
    const dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1, sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;
    while (true) {
      if (!this._walkable(x0, z0)) return false;
      if (x0 === x1 && z0 === z1) return true;
      const e2 = err * 2;
      if (e2 > -dz) { err -= dz; x0 += sx; }
      if (e2 < dx) { err += dx; z0 += sz; }
    }
  }

  findPath(startPos, endPos, maxVisited = 9000) {
    const start = this.nearestWalkable(this.worldToCell(startPos));
    const goal = this.nearestWalkable(this.worldToCell(endPos));
    if (!start || !goal) return [];
    if (start.x === goal.x && start.z === goal.z) return [endPos.clone()];

    const total = this.width * this.height;
    const gScore = new Float32Array(total);
    gScore.fill(Infinity);
    const came = new Int32Array(total);
    came.fill(-1);
    const closed = new Uint8Array(total);
    const heap = new MinHeap();
    const sIdx = this._idx(start.x, start.z);
    const gIdx = this._idx(goal.x, goal.z);
    gScore[sIdx] = 0;
    const h0 = Math.hypot(goal.x - start.x, goal.z - start.z);
    heap.push({ idx: sIdx, x: start.x, z: start.z, f: h0 });

    const dirs = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
    ];
    let visited = 0;
    let found = false;
    while (heap.size && visited++ < maxVisited) {
      const cur = heap.pop();
      if (!cur || closed[cur.idx]) continue;
      closed[cur.idx] = 1;
      if (cur.idx === gIdx) { found = true; break; }
      for (const [dx, dz, cost] of dirs) {
        const nx = cur.x + dx, nz = cur.z + dz;
        if (!this._walkable(nx, nz)) continue;
        // 禁止从两个墙角之间斜穿。
        if (dx && dz && (!this._walkable(cur.x + dx, cur.z) || !this._walkable(cur.x, cur.z + dz))) continue;
        const ni = this._idx(nx, nz);
        if (closed[ni]) continue;
        const ng = gScore[cur.idx] + cost;
        if (ng >= gScore[ni]) continue;
        gScore[ni] = ng;
        came[ni] = cur.idx;
        const h = Math.hypot(goal.x - nx, goal.z - nz);
        heap.push({ idx: ni, x: nx, z: nz, f: ng + h });
      }
    }
    if (!found) return [];

    const cells = [];
    let cur = gIdx;
    while (cur !== -1) {
      cells.push({ x: cur % this.width, z: Math.floor(cur / this.width) });
      if (cur === sIdx) break;
      cur = came[cur];
    }
    cells.reverse();
    let path = cells.map(c => this.cellToWorld(c.x, c.z));
    path[path.length - 1] = endPos.clone();

    // 简单路径平滑：尽量跳过中间节点，但仍以阻挡网格为准。
    const smooth = [];
    let i = 0;
    while (i < path.length) {
      smooth.push(path[i]);
      if (i === path.length - 1) break;
      let next = i + 1;
      for (let j = path.length - 1; j > i + 1; j--) {
        if (this.lineClear(path[i], path[j])) { next = j; break; }
      }
      i = next;
    }
    return smooth;
  }
}
