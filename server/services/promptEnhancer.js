// 提示词润色服务：把用户的简短创意（常是剧目典故，如"林黛玉葬花"）
// 交给文字大模型扩写成"可直接作画"的中文画面描述，并推断行当/剧目/场景等结构化选项。
//
// 背景：Kolors 等扩散模型不具备典故知识，直接把"林黛玉葬花"喂进去只会得到
// 一个普通古装女子。必须先由 LLM 还原出标志性视觉元素（花锄、花囊、落英、
// 素白衣裙），扩散模型才画得对。
//
// 知识增强：润色前先检索「学校自建越剧知识库」（本地微调模型所用的同一份 2139 条语料），
// 把权威词条注入 system prompt 校准史实。例如"黛玉葬花"词条明确记载场景在
// 「沁芳桥畔」，这类细节通用大模型并不知道，注入后画面还原度显著提升。
import config from '../config.js';
import { IMAGE_OPTION_CATALOG, OPTION_ROLE_CONSTRAINTS } from './yuejuImagePrompt.js';
import { retrieveYuejuKnowledge, buildKnowledgeContext } from './yuejuKnowledge.js';
import { askYuejuLocal, isYuejuLocalHealthy } from './yuejuLocalLlm.js';
import { reportApiSuccess, reportApiFailure } from './apiHealth.js';

// 各字段的"默认值"——用户未主动选择时才允许被 AI 建议覆盖，避免推翻用户的明确选择
const FIELD_DEFAULTS = {
  role: ['', 'general'],
  school: ['auto'],
  costume: ['auto'],
  play: ['auto'],
  scene: ['stage'],
  composition: ['full'],
};

function catalogToText(field) {
  return IMAGE_OPTION_CATALOG[field].map(([value, label]) => `${value}（${label}）`).join('、');
}

export function buildSystemPrompt() {
  return [
    '你是越剧舞台美术指导，负责把观众输入的简短创意扩写成"可直接作画"的中文画面描述。',
    '',
    '【画面描述要求】',
    '1. 若输入是剧目典故或人物名（如"林黛玉葬花""十八相送""黛玉焚稿"），必须还原该情节的标志性视觉元素：人物身份与年龄、标志性道具、关键动作、典型环境物件。',
    '   例：林黛玉葬花 = 清瘦少女、肩扛花锄、手提绢制花囊、脚边落满桃花瓣、身前小土堆、素白衣裙、垂柳与花树。',
    '2. 把抽象情绪转成可见特征。不要写"神情哀婉"，要写"低眉垂睫、唇角微抿、肩线微沉"。',
    '3. 只描述画面本身：人物、神态、服饰、道具、动作、环境、光线。不要抒情、不要典故解说、不要人物心理分析。',
    '4. 长度 60-140 字，短句读顿，用中文顿号或逗号分隔，不要分段、不要编号。',
    '5. 严禁出现画风词（水墨、工笔、油画、摄影、写实、3D 等）——画风由系统另行控制。',
    '6. 服装必须明确写出"越剧戏服""宽大水袖""点翠头面/珠钗"等舞台戏曲元素，不能画成现代外套、连衣裙、汉服写真、清宫剧或普通古装照；不要出现文字、水印、标题。',
    '7. 不要描述任何承载可读文字的物件内容（如灵牌刻字、匾额题字、书页字句、对联），',
    '   需要这类物件时只写其形制材质，例如"素白灵位""乌木匾额"。',
    '8. 服饰措辞必须符合人物的身份、性别与处境：贫苦妇人穿粗布衣裙而非员外袍或官服，',
    '   书生穿褶子，命妇穿绣裙。拿不准就只写颜色与质地，不要臆造具体袍服名称。',
    '9. 若参考资料给出了具体地点名或标志性道具（如"沁芳桥畔""花锄""门槛"），应优先写入画面。',
    '10. 动作描述必须准确：写"跪于门槛前"就不要让画面人物站立；写"双手扶门槛"就不要让人物合掌。',
    '     空间关系务必合理：人物跪在地面，不是跪在桌面上。',
    '',
    '11. 若输入明确是某越剧名剧（梁祝/红楼/西厢/祥林嫂等），画面须包含该戏最具辨识度的标志性场景元素，让观者一眼认出是哪出戏：'
      + '梁祝化蝶须有青石墓碑/坟冢与双双飞起的彩蝶，二人皆作越剧小生书生扮相（祝英台女扮男装，绝不可画成裙装或明显女性服饰）；'
      + '红楼黛玉葬花须有花锄、花囊、落花与新培土堆；西厢记须有月下西厢与红娘；祥林嫂须有宗祠门槛。',
    '',
    '【同时推断结构化选项】按输入内容判断下列字段，无法确定时填各字段的默认值：',
    `- role 行当，可选：${catalogToText('role')}；默认 general`,
    `- school 流派，可选：${catalogToText('school')}；不确定填 auto（注意流派须与行当匹配）`,
    `- costume 服饰，可选：${catalogToText('costume')}；不确定填 auto`,
    `- play 剧目，可选：${catalogToText('play')}；不属于已知剧目填 auto`,
    `- scene 场景，可选：${catalogToText('scene')}；默认 stage`,
    `- composition 构图，可选：${catalogToText('composition')}；单人默认 full；输入含两位人物或"相送、对唱、相会、双方"等对戏语义时必须用 duo；强调水袖身段、舞姿时用 dance`,
    '注意：costume 必须与 role 匹配（小生用 mangpao/zhezi，花旦用 duijin/shuixiu，老生用 yuanwai，丑角用 duanda），拿不准就填 auto。'
    + '最终输出画面描述里必须出现"越剧戏服""水袖""头面"等关键词，确保扩散模型不会画成现代服装。',
    '',
    '【输出格式】只输出一个 JSON 对象，不要 markdown 代码块、不要任何解释文字：',
    '{"description":"画面描述","role":"","school":"","costume":"","play":"","scene":"","composition":""}',
  ].join('\n');
}

// few-shot 示例：显著提升小参数模型的典故还原准确度与 JSON 规范度。
// 示例 1 示范单人典故的视觉化拆解，示例 2 示范双人对戏（两位人物都要写、构图用 duo）。
const FEW_SHOT = [
  {
    role: 'user',
    content: '观众输入：林黛玉葬花',
  },
  {
    role: 'assistant',
    content: '{"description":"清瘦越剧花旦立于花树下，素白越剧戏服配淡青云肩、宽大水袖，点翠头面与珠钗，肩扛小花锄，手提绢制花囊，低眉垂睫，唇角微抿，肩线微沉，脚边落满粉白花瓣，身前一座新培的小土堆，垂柳斜出，湖石点缀，晨雾薄笼","role":"huadan","school":"auto","costume":"shuixiu","play":"hongloumeng","scene":"garden","composition":"full"}',
  },
  {
    role: 'user',
    content: '观众输入：梁山伯与祝英台十八相送',
  },
  {
    role: 'assistant',
    content: '{"description":"两位青年书生并肩缓行于长亭古道，一人月白褶子、手执折扇、神情坦然憨直，另一人为女子女扮男装的书生装束、眉目清秀、频频侧首欲言又止，衣袖轻扬，身侧垂柳拂水，石桥横卧，远处白墙黛瓦，春草沿路，两人身形一前一后拉出送别距离","role":"xiaosheng","school":"auto","costume":"zhezi","play":"liangzhu","scene":"waterside","composition":"duo"}',
  },
  {
    role: 'user',
    content: '观众输入：祥林嫂捐门槛',
  },
  {
    role: 'assistant',
    content: '{"description":"中年妇人跪在宗祠门槛前，粗布青蓝衣裙、袖口磨白，佝偻着背，双手撑住高及膝头的旧木门槛，指节发白，面容憔悴，眼窝深陷，唇角干裂，门槛表面斑驳磨损，背后暗影中立着神龛与旧供桌，桌上陈旧香炉与干瘪供果，昏黄光线斜照门槛","role":"huadan","school":"auto","costume":"auto","play":"xianglinsao","scene":"stage","composition":"full"}',
  },
  {
    role: 'user',
    content: '观众输入：梁山伯与祝英台化蝶',
  },
  {
    role: 'assistant',
    content: '{"description":"梁山伯与祝英台化作越剧小生书生形象凌空相依，二人皆月白褶子、头戴文生巾，女扮男装的祝英台与梁山伯并肩，身下一方青石墓碑半隐荒草、碑前彩蝶双双翩然飞起翅翼流光，水袖与蝶翼同展，远山含黛薄雾轻笼","role":"xiaosheng","school":"auto","costume":"zhezi","play":"liangzhu","scene":"garden","composition":"duo"}',
  },
];

/**
 * 收集越剧背景知识，用于校准 LLM 的史实理解。
 *
 * 主通道：校本知识库检索（本地、毫秒级、云端可用）。
 * 增强通道：本地微调模型（Qwen2.5-0.5B + LoRA，需手动启动 3456 服务）。
 *   —— 默认关闭。该模型在"带【出处】标注的百科问答"格式上过拟合，
 *      输出的是百科文而非画面描述，且推理耗时远高于本地检索；
 *      开启后仅作为补充资料，最终画面描述仍由 GLM 生成。
 *
 * @returns {Promise<{context: string, sources: string[], usedLocalLlm: boolean}>}
 */
async function collectYuejuKnowledge(query) {
  const sources = [];
  const blocks = [];
  let usedLocalLlm = false;

  // 1) 校本知识库检索（主通道）
  try {
    const chunks = retrieveYuejuKnowledge(query, { topK: 3 });
    if (chunks.length > 0) {
      blocks.push(buildKnowledgeContext(chunks));
      sources.push(...chunks.map((c) => c.title));
    }
  } catch {
    // 检索失败不影响润色主流程
  }

  // 2) 本地微调模型（可选增强通道）
  if (config.textLlm.useLocalYuejuLlm) {
    try {
      if (await isYuejuLocalHealthy()) {
        const answer = await askYuejuLocal(
          `请简要说明「${query}」在越剧中的剧目归属、人物行当与情节要点。`,
          { maxNewTokens: 220, timeout: 8000 }
        );
        const trimmed = String(answer || '').replace(/\s+/g, ' ').trim().slice(0, 400);
        if (trimmed.length >= 10) {
          blocks.push(`【自研微调模型补充】${trimmed}`);
          sources.push('本地微调模型');
          usedLocalLlm = true;
        }
      }
    } catch {
      // 本地模型未就绪/超时属预期，静默降级
    }
  }

  return { context: blocks.join('\n\n'), sources, usedLocalLlm };
}

// 模型可能把 JSON 包在 ```json 代码块里或前后带解说，这里做鲁棒提取
function parseModelJson(raw) {
  if (!raw) return null;
  let text = String(raw).trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function isValidOption(field, value) {
  if (!value) return false;
  return IMAGE_OPTION_CATALOG[field].some(([key]) => key === value);
}

function cleanDescription(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/^["'「『]+|["'」』]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

// 描述过长会稀释关键视觉元素的权重，按标点截到最近的完整分句
function limitLength(text, max = 160) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const idx = Math.max(cut.lastIndexOf('、'), cut.lastIndexOf('，'), cut.lastIndexOf('。'));
  return (idx > max * 0.6 ? cut.slice(0, idx) : cut).replace(/[、，。;；]$/, '');
}

/**
 * 润色用户输入的生图提示词。
 * @param {object} input
 * @param {string} input.prompt 用户原始输入
 * @param {object} input.current 当前前端已选择的选项，用于判断哪些可被建议覆盖
 * @returns {Promise<{enhanced:string, original:string, suggestions:object, fallback:boolean, reason?:string, knowledge:{sources:string[],usedLocalLlm:boolean}}>}
 */
export async function enhanceImagePrompt({ prompt, current = {} } = {}) {
  const original = cleanDescription(prompt);
  const empty = {
    enhanced: original,
    original,
    suggestions: {},
    fallback: true,
    knowledge: { sources: [], usedLocalLlm: false },
  };

  if (!original) return { ...empty, reason: '描述为空' };
  if (!config.textLlm.enable) return { ...empty, reason: '润色功能已关闭' };

  const { apiUrl, apiKey, apiSecret, model, provider } = config.textLlm;
  if (!apiKey) return { ...empty, reason: '未配置文字模型密钥' };

  // 先取校本知识库资料校准史实（失败不阻断，退化为无知识注入的原流程）
  const knowledge = await collectYuejuKnowledge(original);
  // 讯飞星火 OpenAI 兼容接口要求「仅一个且为首条」的 system 消息，
  // 故把校本知识块并入首条 system，而不能另发一条 system（否则报 NotFirstSystemError）。
  const systemContent = buildSystemPrompt()
    + (knowledge.context ? `\n\n【校本知识补充】\n${knowledge.context}` : '');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

  // 讯飞星火 OpenAI 兼容接口要求 Bearer apiKey:apiSecret（与星辰 Agent 一致），
  // 其他 OpenAI 兼容服务（如百炼）只需 Bearer apiKey。
  const authHeader = (provider === 'iflytek' && apiSecret) ? `Bearer ${apiKey}:${apiSecret}` : `Bearer ${apiKey}`;

  let data;
  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemContent },
          ...FEW_SHOT,
          { role: 'user', content: `观众输入：${original}` },
        ],
        temperature: 0.7,
        max_tokens: 600,
        // 刻意不使用 response_format：实测开启后小参数模型会出现字段名截断与
        // 重复乱码退化，改由 parseModelJson 做鲁棒提取更稳定。
        enable_thinking: false,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      reportApiFailure('textLlm');
      return { ...empty, reason: `文字模型返回 ${resp.status}${detail ? `：${detail.slice(0, 120)}` : ''}` };
    }
    data = await resp.json();
    reportApiSuccess('textLlm');
  } catch (err) {
    reportApiFailure('textLlm');
    const reason = err.name === 'AbortError' ? '文字模型响应超时' : `文字模型请求失败：${err.message}`;
    return { ...empty, reason };
  } finally {
    clearTimeout(timer);
  }

  const parsed = parseModelJson(data?.choices?.[0]?.message?.content);
  if (!parsed) return { ...empty, reason: '文字模型返回格式异常' };

  const enhanced = limitLength(cleanDescription(parsed.description));
  // 扩写结果过短说明模型没干活，退回原文更安全
  if (enhanced.length < 12) return { ...empty, reason: '润色结果过短' };

  // 仅在用户尚未主动选择（字段缺省或仍是默认值）时采纳模型建议，避免覆盖用户的明确意图
  const suggestions = {};
  for (const [field, defaults] of Object.entries(FIELD_DEFAULTS)) {
    const value = parsed[field];
    if (!isValidOption(field, value)) continue;
    if (defaults.includes(value)) continue;
    const currentValue = current[field];
    const untouched = currentValue === undefined || currentValue === null
      || currentValue === '' || defaults.includes(currentValue);
    if (!untouched) continue;
    suggestions[field] = value;
  }

  // 行当一致性校验：流派/服饰各自只适用于特定行当。
  // 模型常见错误是给了 costume 却没给 role（如祥林嫂→墨绿员外袍），
  // 这里以"最终生效的行当"为准剔除错配建议，避免下拉框显示明显不对的选项。
  const effectiveRole = (!FIELD_DEFAULTS.role.includes(current.role) && isValidOption('role', current.role))
    ? current.role
    : (suggestions.role || 'general');
  for (const field of ['school', 'costume']) {
    const value = suggestions[field];
    if (!value) continue;
    const allowedRoles = OPTION_ROLE_CONSTRAINTS[field][value] || [];
    if (allowedRoles.length > 0 && !allowedRoles.includes(effectiveRole)) {
      delete suggestions[field];
    }
  }

  return {
    enhanced,
    original,
    suggestions,
    fallback: false,
    // 命中的校本知识词条，前端据此展示"参考校本知识库：XXX"，增强可信度
    knowledgeSources: knowledge.sources.slice(0, 3),
  };
}

export default { enhanceImagePrompt };
