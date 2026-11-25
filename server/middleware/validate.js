// 输入校验中间件：防止 XSS、超长输入、非法字符
// 对用户提交的文本字段做统一清洗

const MAX_TEXT_LENGTH = 5000; // 普通文本字段最大长度
const MAX_TITLE_LENGTH = 200; // 标题类字段最大长度

/**
 * 清洗字符串：去除首尾空白、移除危险字符
 * 不破坏正常中文/英文/标点，只移除可能的 XSS 载荷
 */
export function sanitizeText(str, maxLen = MAX_TEXT_LENGTH) {
  if (str == null) return '';
  let s = String(str);
  // 移除 null 字节
  s = s.replace(/\0/g, '');
  // 移除 HTML 注释（可能隐藏脚本）
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  // 移除 <script> 标签及内容
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  // 移除事件处理器 on*=
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // 移除 javascript: 协议
  s = s.replace(/javascript:/gi, '');
  // 移除 data: 协议中的 HTML（保留图片 data URI）
  s = s.replace(/data:text\/html/gi, '');
  // 截断超长输入
  if (s.length > maxLen) s = s.slice(0, maxLen);
  // 去除首尾空白
  return s.trim();
}

/**
 * 清洗标题（更严格）
 */
export function sanitizeTitle(str) {
  return sanitizeText(str, MAX_TITLE_LENGTH);
}

/**
 * 校验并清洗请求体中的指定字段
 * @param {string[]} fields - 需要清洗的字段名
 */
export function sanitizeBody(fields) {
  return function (req, res, next) {
    if (!req.body || typeof req.body !== 'object') return next();
    for (const field of fields) {
      if (req.body[field] != null && typeof req.body[field] === 'string') {
        req.body[field] = sanitizeText(req.body[field]);
      }
    }
    next();
  };
}

/**
 * 通用字段校验：必填、长度
 * @param {object} rules - { field: { required?, maxLen? } }
 */
export function validateBody(rules) {
  return function (req, res, next) {
    if (!req.body || typeof req.body !== 'object') return next();
    for (const [field, rule] of Object.entries(rules)) {
      const val = req.body[field];
      if (rule.required && (val == null || String(val).trim() === '')) {
        return res.status(400).json({
          code: 400,
          message: rule.message || `${field} 不能为空`,
          data: null,
        });
      }
      if (val != null && rule.maxLen && String(val).length > rule.maxLen) {
        return res.status(400).json({
          code: 400,
          message: rule.message || `${field} 长度超过限制（${rule.maxLen}字）`,
          data: null,
        });
      }
    }
    next();
  };
}
