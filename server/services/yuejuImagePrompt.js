// 风格预设：tag 最短、放最前仅占一个风格标识位（权重高但不抢主体）；
// body 为详细风格描写，放在主体之后；tail 收尾定调，但**不写**"suggestive rather than literal"，
// 否则会与该画具体主体（如蝴蝶）冲突。negative 为该风格专属反向词。Kolors 为中文训练模型，均中英双语。
const STYLE_PRESETS = {
  ink: {
    label: '水墨写意',
    // 最短风格标识，置于提示词最前
    tag: '中国传统水墨画，Chinese ink wash painting',
    // 详细水墨描写，放在主体之后
    body: '宣纸上的写意水墨，墨分五色，笔墨淋漓，留白意境，极简设色。expressive spontaneous brushwork on rice paper, layered ink tones, elegant negative space, minimal restrained color',
    // 收尾定调：保留水墨韵味，但强调主体清晰可辨（不再写"形散神聚/意在笔先"这类弱化具体形象的指令）
    tail: '以水墨线条与晕染表现，主体清晰可辨，水墨意境与具象形象兼顾，纸纹可见，诗意留白。rendered in fluid ink and wash, the main subject clearly depicted, balancing ink mood with recognizable forms, visible paper texture',
    // 水墨风格必须压制的反向词
    negative: '写实照片，彩色照片，摄影，真实皮肤质感，3D渲染，CGI，油画厚涂，高饱和艳色，照片级细节，plastic',
  },
  gongbi: {
    label: '工笔重彩',
    tag: '中国工笔画，Chinese gongbi fine-brush painting',
    body: '精细白描线条，矿物颜料重彩，工整细腻的平涂设色，传统装饰构图。meticulous precise linework, mineral pigment colors, delicate flat decorative shading, refined traditional composition',
    tail: '精细笔法，典雅纹样，平滑平涂，主体清晰，工致细节。fine detailed brushwork, elegant ornamental patterns, smooth unshaded color fills, the main subject clearly depicted',
    negative: '写意泼墨，抽象，速写，粗糙笔触，写实摄影照片，黑白水墨',
  },
  realistic: {
    label: '舞台写实',
    tag: '写实风格的越剧舞台摄影，realistic Yueju stage photography',
    body: '自然皮肤质感，真实刺绣面料，电影感戏剧光。natural skin texture, authentic embroidered fabric, cinematic theatrical lighting',
    tail: '纪实级细节，清晰对焦，可信的服饰与妆容，主体突出。documentary detail, sharp focus, believable fabric and makeup, the main subject prominent',
    negative: '水墨画，线描，黑白，速写，插画，扁平色块，卡通，油画',
  },
};

const ROLE_PRESETS = {
  general: {
    label: '越剧人物',
    prompt: 'an authentic Yueju Opera performer with refined Jiangnan stage aesthetics and historically coherent costume',
  },
  xiaosheng: {
    label: '小生',
    prompt: 'Yueju xiaosheng, a young male role traditionally portrayed by a female performer, elegant scholarly bearing, clean refined face, graceful but assured posture',
  },
  huadan: {
    label: '花旦',
    prompt: 'Yueju huadan, graceful young female role, restrained Yueju stage makeup, delicate Jiangnan temperament, expressive eyes and elegant hand gestures',
  },
  laosheng: {
    label: '老生',
    prompt: 'Yueju laosheng, dignified mature male role, composed bearing, restrained age makeup, calm and weighty stage presence',
  },
  chou: {
    label: '丑角',
    prompt: 'Yueju chou comic role, lively and agile, witty expression, restrained comic makeup with at most a small white nose accent, never a Jing painted-face role',
  },
};

const SCHOOL_PRESETS = {
  auto: { label: '行当本色', roles: [], prompt: '' },
  xu: {
    label: '徐派', roles: ['xiaosheng'],
    prompt: 'Xu school xiaosheng spirit inspired by Xu Yulan: bright, heroic and passionate while retaining Yueju elegance',
  },
  fan: {
    label: '范派', roles: ['xiaosheng'],
    prompt: 'Fan school xiaosheng spirit inspired by Fan Ruijuan: sincere, mellow, scholarly and naturally poised',
  },
  yin: {
    label: '尹派', roles: ['xiaosheng'],
    prompt: 'Yin school xiaosheng spirit inspired by Yin Guifang: refined, free-flowing, gentle and quietly romantic',
  },
  yuan: {
    label: '袁派', roles: ['huadan'],
    prompt: 'Yuan school huadan spirit inspired by Yuan Xuefen: sincere, profound, natural and emotionally restrained',
  },
  fu: {
    label: '傅派', roles: ['huadan'],
    prompt: 'Fu school huadan spirit inspired by Fu Quanxiang: lyrical, bright, delicate and flowing',
  },
  wang: {
    label: '王派', roles: ['huadan'],
    prompt: 'Wang school huadan spirit inspired by Wang Wenjuan: subtle, gentle, dignified and inwardly expressive',
  },
  zhang: {
    label: '张派', roles: ['laosheng'],
    prompt: 'Zhang school laosheng spirit inspired by Zhang Guifeng: vigorous, dignified, resonant and steady',
  },
  traditional: {
    label: '丑角行当', roles: ['chou'],
    prompt: 'traditional Yueju chou performance lineage, nimble comic rhythm and lively stage presence without exaggerated painted-face conventions',
  },
};

const COSTUME_PRESETS = {
  auto: { label: '自动配装', roles: [], prompt: 'role-appropriate authentic Yueju costume with coherent Jiangnan opera tailoring' },
  mangpao: {
    label: '朱砂蟒袍', roles: ['xiaosheng'],
    prompt: 'a Yueju-style vermilion ceremonial mang robe, elegant round-neck silhouette, restrained gold embroidery, broad sleeves, theatrical yet refined, not imperial court cosplay',
  },
  zhezi: {
    label: '月白褶子', roles: ['xiaosheng'],
    prompt: 'a moon-white Yueju scholar zhezi robe, soft pleated lower panels, narrow embroidered borders, long clean sleeves, understated and literati-like',
  },
  duijin: {
    label: '花旦对襟褂', roles: ['huadan'],
    prompt: 'a pale pink and light cyan Yueju huadan front-opening jacket, delicate floral embroidery, fitted upper body and graceful skirt, Jiangnan elegance',
  },
  shuixiu: {
    label: '绣花水袖衣', roles: ['huadan'],
    prompt: 'a white-based embroidered Yueju huadan costume with long soft water sleeves, lightweight silk drape, fine floral motifs and airy movement',
  },
  yuanwai: {
    label: '墨绿员外袍', roles: ['laosheng'],
    prompt: 'a dark ink-green and brown Yueju yuanwai robe, dignified loose silhouette, restrained round longevity motifs and muted embroidered borders',
  },
  duanda: {
    label: '百衲短打', roles: ['chou'],
    prompt: 'a complete Yueju chou short fighting outfit with patterned jacket, sash, full trousers and cloth boots, playful color blocking, agile and practical',
  },
};

const PLAY_PRESETS = {
  auto: { label: '自由创作', prompt: '' },
  liangzhu: { label: '梁山伯与祝英台', prompt: 'the Yueju classic The Butterfly Lovers (梁山伯与祝英台): two scholars in love, the girl disguised as a boy, finally transformed into a pair of butterflies rising above the tomb' },
  hongloumeng: { label: '红楼梦', prompt: 'the lyrical and melancholic world of the Yueju classic Dream of the Red Chamber, elegant garden atmosphere' },
  xixiangji: { label: '西厢记', prompt: 'the romantic moonlit atmosphere of the Yueju classic Romance of the Western Chamber' },
  xianglinsao: { label: '祥林嫂', prompt: 'the restrained dramatic atmosphere of the Yueju classic Xianglin Sao, humane realism and winter desolation' },
  zhenzhuta: { label: '珍珠塔', prompt: 'the refined Jiangnan household atmosphere of the Yueju classic The Pearl Pagoda' },
  qingqing: { label: '追鱼', prompt: 'the dreamlike waterside atmosphere of the Yueju classic Chasing the Fish Spirit, lyrical ripples and restrained fantasy' },
};

const SCENE_PRESETS = {
  stage: { label: '传统戏台', prompt: 'on a refined Yueju stage with restrained red lacquer columns, embroidered curtain and warm theatrical footlights' },
  garden: { label: '江南园林', prompt: 'in a misty Jiangnan garden with white walls, dark tiled roofs, moon gate and delicate spring blossoms' },
  waterside: { label: '水乡长桥', prompt: 'beside a quiet Jiangnan waterside town, stone bridge, soft rain and distant whitewashed houses' },
  inkland: { label: '水墨远山', prompt: 'before layered ink-wash mountains and drifting mist, poetic negative space and a minimal stage floor' },
  study: { label: '书院庭院', prompt: 'in a classical Jiangnan academy courtyard with bamboo shadows, wooden lattice windows and scholar stones' },
};

const COMPOSITION_PRESETS = {
  full: { label: '全身定式', prompt: 'full-body stage portrait, complete costume and footwear visible, centered stable composition, hands clearly visible' },
  medium: { label: '半身传神', prompt: 'three-quarter portrait from head to below the waist, costume collar and sleeves clearly visible, expressive hands' },
  dance: { label: '身段动态', prompt: 'dynamic full-body Yueju stage movement, readable hand gesture, balanced sleeve motion, anatomically plausible pose' },
  duo: { label: '双人对戏', prompt: 'two Yueju performers in a clearly staged dramatic exchange, distinct silhouettes, coherent eye lines and gestures' },
};

const ASPECT_PRESETS = {
  square: { label: '方幅', width: 1024, height: 1024 },
  portrait: { label: '立轴', width: 768, height: 1024 },
  landscape: { label: '横卷', width: 1024, height: 768 },
};

const ROLE_ALIASES = {
  '': 'general', general: 'general', sheng: 'xiaosheng', xiaosheng: 'xiaosheng',
  dan: 'huadan', huadan: 'huadan', laosheng: 'laosheng', chou: 'chou',
};

function pickPreset(collection, value, fallback) {
  return Object.prototype.hasOwnProperty.call(collection, value) ? value : fallback;
}

function compatiblePreset(collection, value, role, fallback = 'auto') {
  const key = pickPreset(collection, value, fallback);
  const roles = collection[key].roles || [];
  return roles.length === 0 || roles.includes(role) ? key : fallback;
}

function cleanText(value, maxLength = 500) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

// 供提示词润色服务使用：动态导出可选值清单，避免两处硬编码不同步。
// 结构为 { 字段: [[值, 中文标签], ...] }
export const IMAGE_OPTION_CATALOG = {
  role: Object.entries(ROLE_PRESETS).map(([key, v]) => [key, v.label]),
  school: Object.entries(SCHOOL_PRESETS).map(([key, v]) => [key, v.label]),
  costume: Object.entries(COSTUME_PRESETS).map(([key, v]) => [key, v.label]),
  play: Object.entries(PLAY_PRESETS).map(([key, v]) => [key, v.label]),
  scene: Object.entries(SCENE_PRESETS).map(([key, v]) => [key, v.label]),
  composition: Object.entries(COMPOSITION_PRESETS).map(([key, v]) => [key, v.label]),
};

// 供提示词润色服务做建议值校验：某些流派/服饰仅适用于特定行当。
// 空数组表示不限行当。避免 AI 建议出「祥林嫂穿员外袍」这类错配。
export const OPTION_ROLE_CONSTRAINTS = {
  school: Object.fromEntries(Object.entries(SCHOOL_PRESETS).map(([k, v]) => [k, v.roles || []])),
  costume: Object.fromEntries(Object.entries(COSTUME_PRESETS).map(([k, v]) => [k, v.roles || []])),
};

export function normalizeYuejuImageOptions(input = {}) {
  const role = ROLE_ALIASES[input.role] || 'general';
  const style = pickPreset(STYLE_PRESETS, input.style, 'ink');
  const school = compatiblePreset(SCHOOL_PRESETS, input.school, role);
  const costume = compatiblePreset(COSTUME_PRESETS, input.costume, role);
  const play = pickPreset(PLAY_PRESETS, input.play, 'auto');
  const scene = pickPreset(SCENE_PRESETS, input.scene, 'stage');
  const composition = pickPreset(COMPOSITION_PRESETS, input.composition, 'full');
  const aspectRatio = pickPreset(ASPECT_PRESETS, input.aspectRatio, 'square');
  const requestedSeed = Number(input.seed);
  const seed = Number.isInteger(requestedSeed) && requestedSeed >= 0 && requestedSeed <= 2147483647
    ? requestedSeed
    : Math.floor(Math.random() * 2147483647);

  return {
    prompt: cleanText(input.prompt),
    style,
    role,
    school,
    costume,
    play,
    scene,
    composition,
    aspectRatio,
    seed,
    width: ASPECT_PRESETS[aspectRatio].width,
    height: ASPECT_PRESETS[aspectRatio].height,
  };
}

// Diffusion 模型对“靠后词”也有较高权重；为防关键主体（蝴蝶等）被长提示词稀释，
// 在结尾显式重复一次核心形象名词，强制其可见。
const MUST_SHOW = ['蝴蝶', '蝶', '龙', '凤', '仙鹤', '鹤', '鲤鱼', '锦鲤', '宝剑', '花锄', '花囊', '油纸伞', '团扇'];
function buildSubjectAnchor(text) {
  if (!text) return '';
  const found = new Set();
  for (const k of MUST_SHOW) {
    if (text.includes(k)) found.add(k === '蝶' ? '蝴蝶' : k);
  }
  if (found.size === 0) return '';
  const list = [...found];
  return `重点：画面中必须清晰呈现${list.join('、')}，不可缺失。Must clearly depict ${list.join(', ')} as a central, clearly visible element.`;
}

// 化蝶类题材若仍套用“舞台”场景/“双人对戏”构图，会与“凌空化蝶”冲突，自动切换。
const TRANSFORM_KEYWORDS = ['化蝶', '变蝴蝶', '蝴蝶', '蝶'];
function isTransformTheme(text) {
  if (!text) return false;
  return TRANSFORM_KEYWORDS.some((k) => text.includes(k));
}

export function buildYuejuImagePrompt(input = {}) {
  const options = normalizeYuejuImageOptions(input);
  // 化蝶题材：场景默认舞台时切到园林，构图 duo 改 dance，避免与“凌空化蝶”冲突
  if (isTransformTheme(input.prompt) || isTransformTheme(options.prompt)) {
    if (options.scene === 'stage') options.scene = 'garden';
    if (options.composition === 'duo') options.composition = 'dance';
  }
  const stylePreset = STYLE_PRESETS[options.style];

  // 关键调整：把用户画面意境（主体）放在最前、紧接极短风格标识之后，
  // 详细风格描写与行当/服饰/场景等通用预设放其后，避免主体被稀释；
  // 结尾用风格 tail 定调，并追加“核心主体重复”以强化扩散模型对关键形象的遵循。
  const parts = [
    stylePreset.tag,
    options.prompt ? `画面：${options.prompt}` : '',
    stylePreset.body,
    `行当：${ROLE_PRESETS[options.role].prompt}`,
    SCHOOL_PRESETS[options.school].prompt ? `流派：${SCHOOL_PRESETS[options.school].prompt}` : '',
    `服饰：${COSTUME_PRESETS[options.costume].prompt}`,
    PLAY_PRESETS[options.play].prompt ? `剧目意境：${PLAY_PRESETS[options.play].prompt}` : '',
    `场景：${SCENE_PRESETS[options.scene].prompt}`,
    `构图：${COMPOSITION_PRESETS[options.composition].prompt}`,
    stylePreset.tail,
    buildSubjectAnchor(options.prompt),
    '符合越剧文化特征，造型协调，面部清晰，手部自然',
  ].filter(Boolean);

  const negativePrompt = [
    'Peking Opera', 'Beijing opera Jing painted face', 'Kunqu headdress', 'Cantonese opera styling',
    'generic Hanfu fashion photo', 'Qing palace drama', 'Japanese kimono', 'Korean hanbok',
    'fantasy xianxia armor', 'oversized imperial crown', 'full-face mask', 'modern clothing',
    'random calligraphy', 'text', 'subtitle', 'watermark', 'logo',
    'extra arms', 'extra hands', 'extra fingers', 'fused fingers', 'twisted wrists',
    'malformed anatomy', 'duplicate person', 'cropped head', 'cropped costume', 'incomplete lower body',
    stylePreset.negative,
  ].filter(Boolean).join(', ');

  return {
    ...options,
    finalPrompt: parts.join('. '),
    negativePrompt,
    labels: {
      style: STYLE_PRESETS[options.style].label,
      role: ROLE_PRESETS[options.role].label,
      school: SCHOOL_PRESETS[options.school].label,
      costume: COSTUME_PRESETS[options.costume].label,
      play: PLAY_PRESETS[options.play].label,
      scene: SCENE_PRESETS[options.scene].label,
      composition: COMPOSITION_PRESETS[options.composition].label,
      aspectRatio: ASPECT_PRESETS[options.aspectRatio].label,
    },
  };
}
