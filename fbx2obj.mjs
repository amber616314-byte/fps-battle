// fbx2obj.mjs — 把 FBX 转成 OBJ（保留部件名分组，scale 0.01，枪口朝 -Z）
// 用法: node fbx2obj.mjs <input.fbx> <output.obj>
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import fs from 'fs';
import path from 'path';

const input = process.argv[2];
const output = process.argv[3] || 'out.obj';
const SCALE = 0.01; // FBX cm -> 米

const fileBuf = fs.readFileSync(input);
const buf = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength);
const obj = new FBXLoader().parse(buf, path.dirname(path.resolve(input)) + '/');

// 统计
let meshCount = 0, totalVerts = 0;
obj.traverse(c => { if (c.isMesh) { meshCount++; totalVerts += c.geometry.attributes.position.count; } });
console.log('meshes:', meshCount, 'verts:', totalVerts);

// 归一化：中心移到原点（保持朝向不变）
const box = new THREE.Box3().setFromObject(obj);
const center = box.getCenter(new THREE.Vector3());
const size = box.getSize(new THREE.Vector3());
console.log('size(cm):', size.toArray().map(v => v.toFixed(1)).join('x'), 'center:', center.toArray().map(v => v.toFixed(1)).join(','));
obj.position.sub(center);
obj.updateMatrixWorld(true);

// 导出 OBJ
const lines = ['# M4A1 (converted from FBX, CC0)', 'mtllib gun.mtl'];
// 两遍导出：先输出全部顶点，再输出全部面（OBJLoader 流式解析，面索引必须指向已读入顶点）
const vLines = [];
const fLines = [];
let vi = 0, ti = 0, ni = 0;
obj.traverse(c => {
  if (!c.isMesh) return;
  const name = (c.name || 'mesh').replace(/\s+/g, '_');
  const g = c.geometry;
  const p = g.attributes.position, uv = g.attributes.uv, n = g.attributes.normal;
  const m = c.matrixWorld;
  // ---- 第一遍：顶点 ----
  const vStart = vi, tStart = ti, nStart = ni;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m).multiplyScalar(SCALE);
    vLines.push(`v ${v.x.toFixed(5)} ${v.y.toFixed(5)} ${v.z.toFixed(5)}`);
    if (uv) vLines.push(`vt ${uv.getX(i).toFixed(5)} ${(1 - uv.getY(i)).toFixed(5)}`);
    if (n) {
      const vn = new THREE.Vector3(n.getX(i), n.getY(i), n.getZ(i)).applyMatrix4(m).normalize();
      vLines.push(`vn ${vn.x.toFixed(5)} ${vn.y.toFixed(5)} ${vn.z.toFixed(5)}`);
    }
  }
  vi += p.count; ti += uv ? p.count : 0; ni += n ? p.count : 0;
  // ---- 第二遍：面（记录到 fLines，稍后统一输出） ----
  const idx = g.index;
  // FBX 索引 1-based 检测：仅当最小索引 >= 1 且最大索引越界时才是 1-based（0-based 含垃圾索引时保持 0-based，由越界跳过处理）
  let idxBase = 0;
  if (idx) {
    let minIdx = Infinity, maxIdx = -1;
    for (let i = 0; i < idx.count; i++) {
      const v = idx.getX(i);
      if (v < minIdx) minIdx = v;
      if (v > maxIdx) maxIdx = v;
    }
    if (maxIdx >= p.count && minIdx >= 1) idxBase = 1;
  }
  const faces = [];
  for (let i = 0; i < (idx ? idx.count : p.count); i += 3) {
    const a0 = idx ? idx.getX(i) - idxBase : i;
    const b0 = idx ? idx.getX(i + 1) - idxBase : i + 1;
    const c0 = idx ? idx.getX(i + 2) - idxBase : i + 2;
    if (a0 >= p.count || b0 >= p.count || c0 >= p.count) continue; // 跳过越界面
    // OBJ 索引 1-based：局部索引 + 偏移 + 1
    const a = a0 + vStart + 1, b = b0 + vStart + 1, c2 = c0 + vStart + 1;
    const ta = uv ? a0 + tStart + 1 : 0, tb = uv ? b0 + tStart + 1 : 0, tc = uv ? c0 + tStart + 1 : 0;
    const na = n ? a0 + nStart + 1 : 0, nb = n ? b0 + nStart + 1 : 0, nc = n ? c0 + nStart + 1 : 0;
    const f = (x, y, z, t, nn) => `f ${x}/${t || ''}${nn ? '/' + nn : ''} ${y}/${t || ''}${nn ? '/' + nn : ''} ${z}/${t || ''}${nn ? '/' + nn : ''}`;
    // 分别输出三个顶点（uv/法线索引各自独立）
    faces.push(`f ${a}/${ta || ''}${na ? '/' + na : ''} ${b}/${tb || ''}${nb ? '/' + nb : ''} ${c2}/${tc || ''}${nc ? '/' + nc : ''}`);
  }
  fLines.push(`o ${name}`, `usemtl ${name}`, ...faces);
});

fs.writeFileSync(output, [...vLines, ...fLines].join('\n'));
console.log('written', output, fs.statSync(output).size, 'bytes');
