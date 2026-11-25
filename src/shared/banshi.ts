// 越剧唱词板式格律辅助解析 · 核心引擎（纯前端，无外部接口调用）
// ============================================================
// 定位：教师辅助参考工具，所有输出均为「参考」性质，不做绝对判定。
// 规范来源（严格遵守，不得自行发挥）：
//   慢板：以七字句、十字句为主，上下句对称，一板三眼，节奏舒缓
//   中板：七字句为主，上下句，一板一眼，节奏中等
//   嚣板：句式较自由，长短句结合，节奏急促，用于激动情绪
//   流水板：短句为主，多字少腔，节奏快
// 押韵：上下句押韵，韵脚为句尾字；中州韵体系，默认平声押韵，仄声可押
// 句式：七字句为二二三结构，十字句为三三四结构
// 重要：以上为基础规范，实际演唱存在大量艺术特例，仅作参考。

import { pinyin } from 'pinyin-pro';

// ---------------- 类型 ----------------

export type BanshiId = 'manban' | 'zhongban' | 'xiaoban' | 'liushuiban';
export type Verdict = '符合规范' | '常见变体' | '疑似不规范';

export interface BanshiRule {
  id: BanshiId;
  name: string;
  /** 规范原文（页面判定标准面板展示用） */
  spec: string;
  /** 节拍特征 */
  meter: string;
  /** 判定阈值（由「为主 / 较自由 / 短句为主」推导，页面透明展示） */
  standard: string; // 符合规范
  variant: string; // 常见变体
  irregular: string; // 疑似不规范
  /** 程序化判定 */
  isStandard: (n: number) => boolean;
  isVariant: (n: number) => boolean;
}

export interface FootInfo {
  char: string; // 韵脚字
  pinyin: string; // 带调拼音
  zhe: string; // 所属辙（韵部参考）
  toneName: '平' | '仄' | '轻声';
}

export interface AnalyzedSentence {
  index: number; // 1-based
  display: string; // 展示文本（去尾标点）
  charCount: number; // 汉字数
  role: '上句' | '下句';
  verdict: Verdict;
  verdictNote: string;
  /** 结构拆分：七字句 [2,2,3]，十字句 [3,3,4]；其余为 null */
  segments: string[] | null;
  structureLabel: string; // 如「二二三」；不适用时说明原因
  foot: FootInfo | null; // 句尾字信息（非汉字结尾时为 null）
}

export interface AnalyzedPair {
  no: number;
  upper: AnalyzedSentence;
  lower: AnalyzedSentence | null; // 末句未成对时为 null
  rhymed: boolean | null; // null = 无下句
  zheUpper: string | null;
  zheLower: string | null;
  /** 平仄说明（ informational，不做判定） */
  toneNote: string;
  toneFlag: 'ping' | 'ze' | 'mixed' | 'none';
}

export interface AnalysisResult {
  banshi: BanshiRule;
  sentences: AnalyzedSentence[];
  pairs: AnalyzedPair[];
  unpairedIndex: number | null; // 末句为上句时的序号
  stats: {
    sentenceCount: number;
    pairCount: number;
    rhymedPairs: number;
    verdictCounts: Record<Verdict, number>;
    mainZhe: string | null; // 主韵部（下句韵脚众数）
    zheSet: string[]; // 出现过的辙
  };
  suggestions: string[]; // 参考建议（仅「建议 / 参考」表述）
}

export interface ClassicExcerpt {
  id: string;
  title: string;
  banshi: BanshiId;
  source: string;
  text: string;
  note: string;
}

// ---------------- 板式规范（严格按给定内容） ----------------

export const BANSHI_RULES: BanshiRule[] = [
  {
    id: 'manban',
    name: '慢板',
    spec: '以七字句、十字句为主，上下句对称，一板三眼，节奏舒缓',
    meter: '一板三眼',
    standard: '七字句 / 十字句',
    variant: '五、六、八、九、十一、十二字（多为衬字增删）',
    irregular: '其余字数',
    isStandard: (n) => n === 7 || n === 10,
    isVariant: (n) => [5, 6, 8, 9, 11, 12].includes(n),
  },
  {
    id: 'zhongban',
    name: '中板',
    spec: '七字句为主，上下句，一板一眼，节奏中等',
    meter: '一板一眼',
    standard: '七字句',
    variant: '五、六、八、九、十字（多为衬字增删）',
    irregular: '其余字数',
    isStandard: (n) => n === 7,
    isVariant: (n) => [5, 6, 8, 9, 10].includes(n),
  },
  {
    id: 'xiaoban',
    name: '嚣板',
    spec: '句式较自由，长短句结合，节奏急促，用于激动情绪',
    meter: '散板类（急促）',
    standard: '不限字数（句式较自由）',
    variant: '—',
    irregular: '—',
    // 规范明言「句式较自由」，故不作字数限制，均视为符合
    isStandard: () => true,
    isVariant: () => false,
  },
  {
    id: 'liushuiban',
    name: '流水板',
    spec: '短句为主，多字少腔，节奏快',
    meter: '有板无眼（快）',
    standard: '二至七字短句',
    variant: '八至十字',
    irregular: '一未满八字或十一字以上（参考）',
    isStandard: (n) => n >= 2 && n <= 7,
    isVariant: (n) => n >= 8 && n <= 10,
  },
];

export function getBanshi(id: BanshiId): BanshiRule {
  return BANSHI_RULES.find((b) => b.id === id) ?? BANSHI_RULES[0];
}

// ---------------- 韵部表（中州韵 · 十三辙，内置，不调用外部接口） ----------------
// 越剧唱词押韵习惯上以中州韵十三辙为参考。由拼音韵母归辙，十三辙可由现代读音
// 完整推出（言前含 an/ian/uan/üan 等），不存在归并歧义。每辙附常用韵字供参考。

export interface ZheEntry {
  name: string; // 辙名
  finals: string[]; // 拼音韵母（v 代表 ü）
  sample: string; // 常用韵字（示例）
}

export const SHISAN_ZHE: ZheEntry[] = [
  { name: '发花辙', finals: ['a', 'ia', 'ua'], sample: '花、家、马、霞、下' },
  { name: '梭波辙', finals: ['o', 'e', 'uo'], sample: '波、多、河、歌、落' },
  { name: '乜斜辙', finals: ['ie', 've', 'ue'], sample: '斜、月、雪、姐、别' },
  { name: '一七辙', finals: ['i', 'v', 'er'], sample: '一、七、西、鱼、地' },
  { name: '姑苏辙', finals: ['u'], sample: '苏、湖、书、无、路' },
  { name: '怀来辙', finals: ['ai', 'uai'], sample: '来、开、白、海、在' },
  { name: '灰堆辙', finals: ['ei', 'ui'], sample: '灰、堆、梅、泪、醉' },
  { name: '遥条辙', finals: ['ao', 'iao'], sample: '条、高、笑、遥、老' },
  { name: '油求辙', finals: ['ou', 'iu'], sample: '油、求、流、愁、旧' },
  { name: '言前辙', finals: ['an', 'ian', 'uan', 'van'], sample: '言、前、天、圆、见' },
  { name: '人辰辙', finals: ['en', 'in', 'un', 'vn'], sample: '人、辰、春、深、心' },
  { name: '江阳辙', finals: ['ang', 'iang', 'uang'], sample: '江、阳、香、长、方' },
  { name: '中东辙', finals: ['eng', 'ing', 'ong', 'iong'], sample: '中、东、风、声、情' },
];

const FINAL_TO_ZHE = new Map<string, string>();
for (const z of SHISAN_ZHE) for (const f of z.finals) FINAL_TO_ZHE.set(f, z.name);

// ---------------- 拼音 → 韵部 / 平仄 ----------------

const INITIALS_2 = ['zh', 'ch', 'sh'];
const INITIALS_1 = ['b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w'];

/** 取单字拼音（num 声调，如 shu1）。多音字按常用读音（报告中已注明此局限）。 */
function charPinyin(ch: string): string | null {
  if (!/\p{Script=Han}/u.test(ch)) return null;
  const arr = pinyin(ch, { toneType: 'num', type: 'array', nonZh: 'consecutive' });
  const s = arr[0] as string;
  if (!s || !/[a-z]/i.test(s)) return null;
  return s.replace('ü', 'v');
}

/** 由音节拆出韵母（y/w 开头按零声母处理，yu 特判为 v） */
function extractFinal(syllable: string): string {
  let s = syllable.replace(/[0-5]/g, '');
  for (const i of INITIALS_2) {
    if (s.startsWith(i) && s.length > 2) return s.slice(2);
  }
  for (const i of INITIALS_1) {
    if (s.startsWith(i)) {
      const rest = s.slice(1);
      if (!rest) return s; // 声母独字（罕见）
      if (rest === 'u' && i === 'y') return 'v'; // yu → ü
      return rest;
    }
  }
  return s; // 零声母（a, an, er, ou ...）
}

function footInfo(ch: string): FootInfo | null {
  const py = charPinyin(ch);
  if (!py) return null;
  const tone = parseInt(py.match(/[0-5]$/)?.[0] ?? '0', 10);
  const final = extractFinal(py);
  const zhe = FINAL_TO_ZHE.get(final) ?? null;
  const toneName: FootInfo['toneName'] = tone === 1 || tone === 2 ? '平' : tone >= 3 ? '仄' : '轻声';
  return {
    char: ch,
    pinyin: py,
    zhe: zhe ?? '未收录',
    toneName,
  };
}

// ---------------- 分句 / 字数 / 结构 ----------------

const SPLIT_RE = /[，。！？；、,.!?;:\n\r…—]+/;

/** 分句：按标点与换行切分，过滤空白 */
export function splitSentences(text: string): string[] {
  return text
    .split(SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 汉字序列（去掉标点、空格、字母数字等非汉字） */
function hanOnly(s: string): string {
  return Array.from(s)
    .filter((c) => /\p{Script=Han}/u.test(c))
    .join('');
}

/** 结构拆分：七字句 2-2-3，十字句 3-3-4（标准句式才有） */
function splitStructure(chars: string): { segments: string[] | null; label: string } {
  const n = chars.length;
  if (n === 7) {
    return { segments: [chars.slice(0, 2), chars.slice(2, 4), chars.slice(4, 7)], label: '二二三' };
  }
  if (n === 10) {
    return { segments: [chars.slice(0, 3), chars.slice(3, 6), chars.slice(6, 10)], label: '三三四' };
  }
  return { segments: null, label: `非七字/十字句，暂不作结构标注（参考）` };
}

// ---------------- 主解析 ----------------

export function analyze(text: string, banshiId: BanshiId): AnalysisResult {
  const banshi = getBanshi(banshiId);
  const parts = splitSentences(text);

  const sentences: AnalyzedSentence[] = parts.map((raw, i) => {
    const chars = hanOnly(raw);
    const n = chars.length;
    const role: '上句' | '下句' = i % 2 === 0 ? '上句' : '下句';

    let verdict: Verdict;
    if (banshi.isStandard(n)) verdict = '符合规范';
    else if (banshi.isVariant(n)) verdict = '常见变体';
    else verdict = '疑似不规范';
    const verdictNote =
      verdict === '符合规范'
        ? `${banshi.name}常用句式（${banshi.standard}）`
        : verdict === '常见变体'
          ? `${n} 字，属${banshi.name}邻近字数的常见变体（参考）`
          : `${n} 字，与${banshi.name}常用句式（${banshi.standard}）差异较大（参考）`;

    const { segments, label } = splitStructure(chars);
    const foot = n > 0 ? footInfo(chars[n - 1]) : null;

    return {
      index: i + 1,
      display: raw,
      charCount: n,
      role,
      verdict,
      verdictNote,
      segments,
      structureLabel: label,
      foot,
    };
  });

  // 上下句配对
  const pairs: AnalyzedPair[] = [];
  for (let i = 0; i + 1 < sentences.length; i += 2) {
    const upper = sentences[i];
    const lower = sentences[i + 1];
    const zu = upper.foot?.zhe ?? null;
    const zl = lower.foot?.zhe ?? null;
    const rhymed = zu !== null && zu === zl && zu !== '未收录';
    const tU = upper.foot?.toneName;
    const tL = lower.foot?.toneName;
    let toneNote = '';
    let toneFlag: AnalyzedPair['toneFlag'] = 'none';
    if (tU && tL) {
      if (tU === '平' && tL === '平') {
        toneNote = '韵脚均为平声，贴合默认平声押韵偏好';
        toneFlag = 'ping';
      } else if (tU === '仄' && tL === '仄') {
        toneNote = '韵脚均为仄声（仄声可押）';
        toneFlag = 'ze';
      } else {
        toneNote = '韵脚平仄相间（上句仄收、下句平收亦为常见处理，参考）';
        toneFlag = 'mixed';
      }
    }
    pairs.push({ no: pairs.length + 1, upper, lower, rhymed, zheUpper: zu, zheLower: zl, toneNote, toneFlag });
  }
  const unpairedIndex = sentences.length % 2 === 1 ? sentences.length : null;

  // 统计
  const verdictCounts: Record<Verdict, number> = { 符合规范: 0, 常见变体: 0, 疑似不规范: 0 };
  for (const s of sentences) verdictCounts[s.verdict]++;
  const rhymedPairs = pairs.filter((p) => p.rhymed).length;
  const lowerZhes = pairs.map((p) => p.zheLower).filter((z): z is string => !!z && z !== '未收录');
  const zheCount = new Map<string, number>();
  for (const z of lowerZhes) zheCount.set(z, (zheCount.get(z) ?? 0) + 1);
  const mainZhe =
    [...zheCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const zheSet = [...new Set(sentences.map((s) => s.foot?.zhe).filter((z): z is string => !!z && z !== '未收录'))];

  // 参考建议（全部使用「建议 / 参考」表述，禁止判定性措辞）
  const suggestions: string[] = [];
  const sampleByZhe = (z: string) => SHISAN_ZHE.find((s) => s.name === z)?.sample ?? '';

  for (const s of sentences) {
    if (s.verdict === '疑似不规范') {
      suggestions.push(
        `第 ${s.index} 句（${s.role}）共 ${s.charCount} 字，${s.verdictNote}。建议参考「${banshi.name}：${banshi.spec}」调整句式，或请教专业教师。`,
      );
    }
    if (s.charCount > 0 && !s.foot) {
      suggestions.push(`第 ${s.index} 句句尾非汉字，未能判定韵脚，建议人工核对句读。`);
    }
  }
  for (const p of pairs) {
    if (p.lower && !p.rhymed) {
      const fU = p.upper.foot;
      const fL = p.lower.foot;
      if (fU && fL && fU.zhe !== '未收录' && fL.zhe !== '未收录') {
        const sample = sampleByZhe(fL.zhe);
        suggestions.push(
          `第 ${p.no} 组上下句韵脚「${fU.char}」（${fU.zhe}）与「${fL.char}」（${fL.zhe}）分属不同韵部，如需押韵，建议参考${fL.zhe}常用韵字（如：${sample}）调整。`,
        );
      } else {
        suggestions.push(`第 ${p.no} 组上下句韵脚未能完整判定，建议人工核对韵脚读音。`);
      }
    }
    if (p.lower && p.rhymed && p.toneFlag === 'ze') {
      suggestions.push(`第 ${p.no} 组押韵韵脚为仄声；中州韵默认平声押韵、仄声可押，如需贴合默认偏好可参考平声韵字。`);
    }
  }
  if (unpairedIndex) {
    suggestions.push(`第 ${unpairedIndex} 句为上句，未检测到对应下句，建议参考上下句成对的体例补全（参考）。`);
  }
  if (zheSet.length > 1) {
    suggestions.push(`唱词韵脚涉及多个韵部（${zheSet.join('、')}），可能存在换辙安排，建议结合唱段整体布局参考。`);
  }
  suggestions.push('以上解析均基于基础规范给出参考建议；实际演唱存在大量艺术特例，请以专业教师判定为准。');

  return {
    banshi,
    sentences,
    pairs,
    unpairedIndex,
    stats: {
      sentenceCount: sentences.length,
      pairCount: pairs.length,
      rhymedPairs,
      verdictCounts,
      mainZhe,
      zheSet,
    },
    suggestions,
  };
}

// ---------------- 内置教学示例（自带测试用例，打开即可演示） ----------------
// 说明：内置示例为教学参考示例（仿经典唱段风格），用于演示各板式判定分支；
// 接入史料库 RAG 后，可由下方预留接口检索真实经典唱段替换。

export const BUILTIN_EXCERPTS: ClassicExcerpt[] = [
  {
    id: 'ex-manban',
    title: '楼台诀别（教学示例）',
    banshi: 'manban',
    source: '仿经典唱段风格 · 演示十字句（三三四）与七字句（二二三）',
    text: [
      '想当年同窗共读情意深，',
      '草桥结拜两同心。',
      '三载寒窗共晨昏，',
      '十八相送意难分。',
      '谁料想好事化灰尘，',
      '楼台相会泪满襟。',
    ].join('\n'),
    note: '韵脚：深、心、昏、分、尘、襟（人辰辙）；第 5 句为 8 字，演示「常见变体」分支。',
  },
  {
    id: 'ex-zhongban',
    title: '西窗月（教学示例）',
    banshi: 'zhongban',
    source: '仿经典唱段风格 · 演示七字句与变体、疑似分支',
    text: [
      '书房门前一炷香，',
      '窗前明月照西厢。',
      '默默含情诉衷肠，',
      '两地相思各一方。',
      '一片相思托付月光，',
      '梦里相逢喜洋洋。',
      '相思长，夜未央，',
      '一片痴心两地藏。',
    ].join('\n'),
    note: '韵脚：江阳辙；第 5 句为 8 字（常见变体），第 7、8 句为 3 字（演示「疑似不规范」参考分支），末句未成对。',
  },
  {
    id: 'ex-xiaoban',
    title: '诀别惊变（教学示例）',
    banshi: 'xiaoban',
    source: '仿经典唱段风格 · 演示长短句自由结合',
    text: [
      '恨只恨月老错牵红线，',
      '怨只怨爹娘拆散姻缘。',
      '一别楼台音容远，',
      '再见除非梦里边。',
      '你可知妹妹泪涟涟，',
      '今生难了情一段！',
    ].join('\n'),
    note: '句式 9/9/7/7/8/7 字，嚣板句式较自由，均视为符合；第 3 组下句韵脚「段」为仄声，演示「仄声可押」分支。',
  },
  {
    id: 'ex-liushuiban',
    title: '夤夜兼程（教学示例）',
    banshi: 'liushuiban',
    source: '仿经典唱段风格 · 演示短句快节奏',
    text: ['夜雨下，更鼓打，', '梦回山伯泪如麻。', '醒来枕上湿罗纱，', '连夜收拾行程罢，', '天明之前到祝家。'].join('\n'),
    note: '句式 3/3/7/7/7 字（短句为主）；第 1 组韵脚「下、打」均为仄声，演示「仄声可押」分支。',
  },
];

// ---------------- 史料库 RAG 检索 · 预留接口 ----------------
// 对接约定（预留，当前返回内置示例，离线可用）：
//   POST /api/history-rag/search
//   body: { type: 'classic-excerpt', banshi: BanshiId, keyword?: string, limit?: number }
//   resp: { excerpts: ClassicExcerpt[] }
// 页面点击「从史料库检索范例」时调用本函数；未接入前 source 返回 'builtin'，
// 前端据此提示「史料库检索接口预留中，当前展示内置教学示例」。

export interface HistoryRagQuery {
  banshi: BanshiId;
  keyword?: string;
  limit?: number;
}

export interface HistoryRagResult {
  source: 'builtin' | 'rag';
  excerpts: ClassicExcerpt[];
  message: string;
}

export async function fetchClassicExcerpts(q: HistoryRagQuery): Promise<HistoryRagResult> {
  // 当前从内置教学示例中筛选：先按板式过滤，再按关键词做包含匹配。
  // 接入史料库时只需替换此处数据来源，返回结构保持不变，调用方无需改动。
  const kw = q.keyword ?? '';
  const excerpts = BUILTIN_EXCERPTS.filter((e) => e.banshi === q.banshi && (!kw || e.text.includes(kw)));
  return {
    source: 'builtin',
    excerpts,
    message: '史料库 RAG 检索接口预留中，当前展示内置教学示例（接入后可检索真实经典唱段）',
  };
}
