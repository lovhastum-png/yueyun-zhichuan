// 临时脚本：解析 venue GLB 的节点世界包围盒，用于确定戏台符号层的安全摆放位置
import { readFile } from 'node:fs/promises';

const file = process.argv[2];
const buffer = await readFile(file);
const jsonLength = buffer.readUInt32LE(12);
const jsonText = buffer.slice(20, 20 + jsonLength).toString('utf8');
const gltf = JSON.parse(jsonText);

const accessors = gltf.accessors || [];
const meshes = gltf.meshes || [];
const nodes = gltf.nodes || [];

function multiplyMatrix(a, b) {
  const out = new Array(16).fill(0);
  for (let i = 0; i < 4; i += 1) {
    for (let j = 0; j < 4; j += 1) {
      for (let k = 0; k < 4; k += 1) {
        out[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k];
      }
    }
  }
  return out;
}

function localMatrix(node) {
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  if (node.matrix) {
    // glTF 列主序已是目标布局
    return node.matrix.slice();
  }
  const t = node.translation || [0, 0, 0];
  const q = node.rotation || [0, 0, 0, 1];
  const s = node.scale || [1, 1, 1];
  const [x, y, z, w] = q;
  const x2 = x + x; const y2 = y + y; const z2 = z + z;
  const xx = x * x2; const yy = y * y2; const zz = z * z2;
  const xy = x * y2; const xz = x * z2; const yz = y * z2;
  const wx = w * x2; const wy = w * y2; const wz = w * z2;
  const r = [
    1 - (yy + zz), xy - wz, xz + wy,
    xy + wz, 1 - (xx + zz), yz - wx,
    xz - wy, yz + wx, 1 - (xx + yy)
  ];
  for (let i = 0; i < 3; i += 1) {
    m[0 + i] = r[i] * s[0];
    m[4 + i] = r[3 + i] * s[1];
    m[8 + i] = r[6 + i] * s[2];
  }
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2];
  return m;
}

function applyMatrix(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]
  ];
}

const worldMatrices = new Map();
function resolveMatrix(nodeIndex, parentMatrix) {
  const node = nodes[nodeIndex];
  const world = multiplyMatrix(parentMatrix, localMatrix(node));
  worldMatrices.set(nodeIndex, world);
  (node.children || []).forEach((child) => resolveMatrix(child, world));
}

const roots = gltf.scenes?.[gltf.scene || 0]?.nodes || [];
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
roots.forEach((rootIndex) => resolveMatrix(rootIndex, identity));

let minX = Infinity; let minY = Infinity; let minZ = Infinity;
let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
const partBounds = [];
nodes.forEach((node, nodeIndex) => {
  if (!node.mesh && node.mesh !== 0) return;
  const world = worldMatrices.get(nodeIndex);
  const mesh = meshes[node.mesh];
  const partMin = [Infinity, Infinity, Infinity];
  const partMax = [-Infinity, -Infinity, -Infinity];
  (mesh.primitives || []).forEach((primitive) => {
    const accessor = accessors[primitive.attributes.POSITION];
    if (!accessor || !accessor.min) return;
    const corners = [];
    for (const x of [accessor.min[0], accessor.max[0]]) {
      for (const y of [accessor.min[1], accessor.max[1]]) {
        for (const z of [accessor.min[2], accessor.max[2]]) corners.push([x, y, z]);
      }
    }
    corners.forEach((corner) => {
      const worldCorner = applyMatrix(world, corner);
      for (let axis = 0; axis < 3; axis += 1) {
        partMin[axis] = Math.min(partMin[axis], worldCorner[axis]);
        partMax[axis] = Math.max(partMax[axis], worldCorner[axis]);
        if (axis === 0) { minX = Math.min(minX, worldCorner[0]); maxX = Math.max(maxX, worldCorner[0]); }
        if (axis === 1) { minY = Math.min(minY, worldCorner[1]); maxY = Math.max(maxY, worldCorner[1]); }
        if (axis === 2) { minZ = Math.min(minZ, worldCorner[2]); maxZ = Math.max(maxZ, worldCorner[2]); }
      }
    });
  });
  if (partMin[0] !== Infinity && node.name) {
    partBounds.push({ name: node.name, min: partMin.map((v) => v.toFixed(2)), max: partMax.map((v) => v.toFixed(2)) });
  }
});

const fmt = (v) => v.toFixed(2);
console.log(`整体包围盒: X[${fmt(minX)}, ${fmt(maxX)}] Y[${fmt(minY)}, ${fmt(maxY)}] Z[${fmt(minZ)}, ${fmt(maxZ)}]`);
console.log(`网格数: ${partBounds.length}`);
console.log('主要部件（按尺寸排序，前 24 个）:');
partBounds
  .map((part) => ({ ...part, size: Math.max(...part.max.map((v, i) => v - part.min[i])) }))
  .sort((a, b) => b.size - a.size)
  .slice(0, 24)
  .forEach((part) => {
    console.log(`  ${part.name}: X[${part.min[0]}, ${part.max[0]}] Y[${part.min[1]}, ${part.max[1]}] Z[${part.min[2]}, ${part.max[2]}]`);
  });
