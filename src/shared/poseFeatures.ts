// ============================================================
// 身段特征提取（浏览器端）—— 20 维关节角特征
// ------------------------------------------------------------
// 从 `scripts/动作识别/dtw_pose_match.py` 移植：MediaPipe Pose(33点)
// + Hands(21点×2) 关键点 → [身体10维 | 左手5维 | 右手5维] 关节角(度)。
// 在浏览器端就地折算，仅把 20 维特征发往评分服务（省带宽、不传视频）。
//
// 手部左右判定不依赖 MediaPipe handedness 标签（其假定输入已镜像，
// 前置摄像头原始流需交换标签，易踩坑），而是几何匹配：把每只检测到的
// 手绑定到距离最近的 Pose 手腕（左手腕=15，右手腕=16）。
// ============================================================

export interface LmPoint {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

// MediaPipe Pose 关键点索引（与脚本版 _LM 一致）
const LM = {
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16,
  leftIndex: 19, rightIndex: 21,
  leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
} as const;

// 10 维身体关节角：(顶点, 端点A, 端点B)，前 6 维手臂、后 4 维腿
const ANGLE_TRIPLES: ReadonlyArray<readonly [number, number, number]> = [
  [LM.leftElbow, LM.leftShoulder, LM.leftWrist],
  [LM.rightElbow, LM.rightShoulder, LM.rightWrist],
  [LM.leftShoulder, LM.leftElbow, LM.leftHip],
  [LM.rightShoulder, LM.rightElbow, LM.rightHip],
  [LM.leftWrist, LM.leftElbow, LM.leftIndex],
  [LM.rightWrist, LM.rightElbow, LM.rightIndex],
  [LM.leftHip, LM.leftShoulder, LM.leftKnee],
  [LM.rightHip, LM.rightShoulder, LM.rightKnee],
  [LM.leftKnee, LM.leftHip, LM.leftAnkle],
  [LM.rightKnee, LM.rightHip, LM.rightAnkle],
];

// 5 维手指弯曲角：(中关节=顶点, 根, 尖)，伸直约 160~175 度
const FINGER_TRIPLES: ReadonlyArray<readonly [number, number, number]> = [
  [2, 1, 4],    // 拇指: CMC-MCP-TIP
  [6, 5, 8],    // 食指: MCP-PIP-TIP
  [10, 9, 12],  // 中指
  [14, 13, 16], // 无名指
  [18, 17, 20], // 小指
];

export const TOTAL_DIM = 20;

// 手-腕绑定距离阈值（归一化坐标）
const WRIST_MATCH_DIST = 0.35;

function angleAt(vertex: LmPoint, pa: LmPoint, pb: LmPoint): number {
  const ux = pa.x - vertex.x, uy = pa.y - vertex.y, uz = pa.z - vertex.z;
  const vx = pb.x - vertex.x, vy = pb.y - vertex.y, vz = pb.z - vertex.z;
  const nu = Math.hypot(ux, uy, uz);
  const nv = Math.hypot(vx, vy, vz);
  if (nu < 1e-9 || nv < 1e-9) return 0;
  const c = Math.min(1, Math.max(-1, (ux * vx + uy * vy + uz * vz) / (nu * nv)));
  return (Math.acos(c) * 180) / Math.PI;
}

/**
 * 姿态是否有效：MediaPipe 已输出完整骨架点即有效（与脚本版判定一致）。
 * 不做可见性强校验——坐姿/半身场景下髋部可见性低，但仍可提取角度特征参与比对。
 */
export function poseLandmarksValid(lm: LmPoint[] | null | undefined): lm is LmPoint[] {
  if (!lm || lm.length < 29) return false;
  // 只凭「关键点数组长度」会把人体只露出一半、手臂被遮挡或追踪跳变的帧
  // 当作有效动作，后续角度会在两三帧内剧烈跳动并污染 DTW。身段评分至少
  // 需要肩、肘、腕六点可靠；髋/腿允许在半身画面中可见度较低。
  const upperBody = [
    LM.leftShoulder, LM.rightShoulder,
    LM.leftElbow, LM.rightElbow,
    LM.leftWrist, LM.rightWrist,
  ];
  return upperBody.every((index) => {
    const point = lm[index];
    return !!point
      && Number.isFinite(point.x)
      && Number.isFinite(point.y)
      && Number.isFinite(point.z)
      && (point.visibility ?? 1) >= 0.35;
  });
}

/** (33,3) 姿态关键点 → 10 维身体关节角（度） */
export function bodyAngles(poseLm: LmPoint[]): number[] {
  return ANGLE_TRIPLES.map(([j, a, b]) => angleAt(poseLm[j], poseLm[a], poseLm[b]));
}

/** 21 个手部关键点 → 5 维手指弯曲角（度） */
export function fingerAngles(handLm: LmPoint[]): number[] {
  return FINGER_TRIPLES.map(([t, a, b]) => angleAt(handLm[t], handLm[a], handLm[b]));
}

export interface FeatureInput {
  poseLm: LmPoint[] | null;
  /** MediaPipe Hands 输出的多只手关键点（0~2 只） */
  handLms: LmPoint[][];
}

export type FeatureRow = ReadonlyArray<number | null>;

/**
 * 姿态 + 手部关键点 → 20 维特征行。
 * - 姿态无效 → null（该帧不发送）；
 * - 某侧手未检出 → 对应 5 维为 null（JSON 传输时即 null，服务端还原 NaN）。
 */
export function extractFeatures({ poseLm, handLms }: FeatureInput): FeatureRow | null {
  if (!poseLandmarksValid(poseLm)) return null;
  const pose = poseLm as LmPoint[];

  // 手→腕几何绑定：每只手分配给最近的（且在阈值内的）同侧/对侧手腕
  let leftHand: LmPoint[] | null = null;
  let rightHand: LmPoint[] | null = null;
  if (handLms.length > 0) {
    const leftWrist = pose[LM.leftWrist];
    const rightWrist = pose[LM.rightWrist];
    for (const hand of handLms) {
      if (!hand || hand.length < 21) continue;
      const hw = hand[0];
      const dl = Math.hypot(hw.x - leftWrist.x, hw.y - leftWrist.y);
      const dr = Math.hypot(hw.x - rightWrist.x, hw.y - rightWrist.y);
      if (dl <= dr && dl < WRIST_MATCH_DIST) leftHand = hand;
      else if (dr < dl && dr < WRIST_MATCH_DIST) rightHand = hand;
    }
  }

  const left = leftHand ? fingerAngles(leftHand) : null;
  const right = rightHand ? fingerAngles(rightHand) : null;
  const body = bodyAngles(pose);
  return [
    ...body,
    ...(left ?? [null, null, null, null, null]),
    ...(right ?? [null, null, null, null, null]),
  ];
}

// ---------- 骨架绘制（叠加层用，坐标为 0~1 归一化） ----------
export const POSE_BONES: ReadonlyArray<readonly [number, number]> = [
  [11, 12],                    // 肩连线
  [11, 13], [13, 15],          // 左臂
  [12, 14], [14, 16],          // 右臂
  [11, 23], [12, 24],          // 躯干
  [23, 24],                    // 髋连线
  [23, 25], [25, 27],          // 左腿
  [24, 26], [26, 28],          // 右腿
];

export const HAND_BONES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],        // 拇指
  [0, 5], [5, 6], [6, 7], [7, 8],        // 食指
  [5, 9], [9, 10], [10, 11], [11, 12],   // 中指
  [9, 13], [13, 14], [14, 15], [15, 16], // 无名指
  [13, 17], [17, 18], [18, 19], [19, 20],// 小指
  [0, 17],                               // 掌根
];
