// ============================================================
// OpenAPI 3.0 规范 + Swagger UI 挂载
// 访问 /api-docs 即可查看交互式 API 文档
// ============================================================
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';

const router = Router();

// OpenAPI 3.0 规范
const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: '越韵智传 · 越剧教学平台 API',
    description: `
越韵智传是一个融合 AI 与非遗越剧文化的教学辅助平台。

## 核心能力
- **智能问答**：基于 RAG 检索增强的越剧知识问答
- **多智能体协作**：4 个专家 Agent（教授/顾问/艺术/班主任）协同
- **AI 批改**：双判机制（向量相似度 0.3 + LLM 语义 0.7）
- **知识图谱**：468 实体 3D 可视化
- **数据飞轮**：高频问题沉淀 → 教师审核 → 自动入库 RAG
- **系统监控**：实时日志/请求统计/资源占用

## 鉴权方式
所有需登录接口请在 Header 携带：
\`\`\`
Authorization: Bearer <token>
\`\`\`
token 通过 \`POST /api/auth/login\` 获取。

## 角色权限
- **teacher**：教师，可访问所有功能（AI 助手、知识飞轮、系统监控等）
- **student**：学生，可访问学习相关功能（问答、课程、作业、考试等）
    `,
    version: '1.0.0',
    contact: {
      name: '越韵智传团队',
      description: '2026 中国青年科技创新揭榜挂帅擂台赛',
    },
    license: {
      name: 'MIT',
    },
  },
  servers: [
    { url: '/api', description: '当前服务器' },
    { url: 'http://localhost:3000/api', description: '本地开发' },
  ],
  tags: [
    { name: '认证', description: '登录注册、Token 管理' },
    { name: '智能问答', description: '越剧 AI 知识问答（流式 SSE）' },
    { name: '多智能体', description: '4 专家协作问答（流式 SSE）' },
    { name: '知识飞轮', description: '高频问题审核入库（教师）' },
    { name: '课程', description: '课程管理、成员、章节' },
    { name: '作业', description: '作业发布、提交、AI 批改' },
    { name: '考试', description: '考试管理、答题、AI 批改' },
    { name: '考勤', description: '签到、出勤统计' },
    { name: '知识图谱', description: '实体关系查询' },
    { name: '系统', description: '健康检查、系统状态、日志监控' },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT Token，通过 POST /api/auth/login 获取',
      },
    },
    schemas: {
      SuccessResponse: {
        type: 'object',
        properties: {
          code: { type: 'integer', example: 0, description: '0 表示成功' },
          message: { type: 'string', example: '操作成功' },
          data: { type: 'object', nullable: true },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          code: { type: 'integer', example: 400 },
          message: { type: 'string', example: '参数错误' },
          data: { type: 'object', nullable: true },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          username: { type: 'string', example: 'teacher' },
          realName: { type: 'string', example: '王老师' },
          role: { type: 'string', enum: ['teacher', 'student'], example: 'teacher' },
        },
      },
      KnowledgeReview: {
        type: 'object',
        description: '知识飞轮审核项',
        properties: {
          id: { type: 'integer', example: 1 },
          question: { type: 'string', example: '越剧的四大流派是什么？' },
          askCount: { type: 'integer', example: 8, description: '被问次数' },
          bestAnswer: { type: 'string', description: 'AI 最佳回答' },
          bestSources: { type: 'array', items: { type: 'object' } },
          status: { type: 'string', enum: ['pending', 'approved', 'rejected'], example: 'pending' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  paths: {
    // ========== 认证 ==========
    '/auth/login': {
      post: {
        tags: ['认证'],
        summary: '用户登录',
        description: '用户名密码登录，返回 JWT Token',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'password'],
                properties: {
                  username: { type: 'string', example: 'teacher' },
                  password: { type: 'string', example: 'teacher123', format: 'password' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: '登录成功',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    code: { type: 'integer', example: 0 },
                    message: { type: 'string', example: '登录成功' },
                    data: {
                      type: 'object',
                      properties: {
                        token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIs...' },
                        user: { $ref: '#/components/schemas/User' },
                      },
                    },
                  },
                },
              },
            },
          },
          400: { description: '用户名或密码错误', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/auth/register': {
      post: {
        tags: ['认证'],
        summary: '用户注册',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'password', 'role'],
                properties: {
                  username: { type: 'string', example: 'newuser' },
                  password: { type: 'string', format: 'password', example: '123456' },
                  role: { type: 'string', enum: ['teacher', 'student'], example: 'student' },
                  realName: { type: 'string', example: '张三' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: '注册成功', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
          400: { description: '用户名已存在', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },

    // ========== 智能问答 ==========
    '/chat/stream': {
      post: {
        tags: ['智能问答'],
        summary: '流式问答（SSE）',
        description: '基于 RAG 检索增强的越剧知识问答，返回 SSE 流式响应。事件类型：token/rag/sources/cards/done/error',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['message'],
                properties: {
                  message: { type: 'string', example: '越剧的起源是什么？' },
                  sessionId: { type: 'string', description: '会话ID，不传则新建' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'SSE 流式响应', content: { 'text/event-stream': {} } },
          401: { description: '未登录', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/chat/history': {
      get: {
        tags: ['智能问答'],
        summary: '聊天历史列表',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: '成功', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } } },
      },
    },

    // ========== 多智能体 ==========
    '/multi-agent/chat': {
      post: {
        tags: ['多智能体'],
        summary: '多智能体协作问答（SSE）',
        description: `
4 个专家 Agent 协同处理用户问题。

## 专家角色
- **professor** 越剧教授：历史/流派/剧目/行当/唱腔
- **advisor** 学业顾问：课程/作业/考试/成绩/错题
- **artist** 艺术指导：AI 生图/唱腔/身段/舞台
- **mentor** 班主任：签到/出勤/学习态度

## SSE 事件类型
- \`routing\`：路由决策（选择哪些专家）
- \`expert_start\`：专家开始处理
- \`tool_start\` / \`tool_end\`：工具调用（带 round 标记）
- \`rag\`：RAG 检索结果（含完整 content）
- \`expert_end\`：专家完成（带 duration_ms/chars）
- \`summarizer_start\` / \`summarizer_end\`：汇总阶段
- \`token\`：最终汇总回答流式 token
- \`done\`：完成（含 expertStats/totalDuration）
        `,
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['message'],
                properties: {
                  message: { type: 'string', example: '我的成绩怎么样？需要重点学习哪些越剧流派？' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'SSE 流式响应', content: { 'text/event-stream': {} } },
        },
      },
    },

    // ========== 知识飞轮 ==========
    '/knowledge-review/pending': {
      get: {
        tags: ['知识飞轮'],
        summary: '获取待审核高频问题',
        description: '教师专用。返回学生提问沉淀的高频问题，按被问次数降序',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          { name: 'minAsk', in: 'query', schema: { type: 'integer', default: 1 }, description: '最小被问次数' },
        ],
        responses: {
          200: {
            description: '成功',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    code: { type: 'integer', example: 0 },
                    data: {
                      type: 'object',
                      properties: {
                        list: { type: 'array', items: { $ref: '#/components/schemas/KnowledgeReview' } },
                        stats: {
                          type: 'object',
                          properties: {
                            pending_count: { type: 'integer' },
                            approved_count: { type: 'integer' },
                            rejected_count: { type: 'integer' },
                            max_ask: { type: 'integer' },
                            total: { type: 'integer' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          403: { description: '非教师角色', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/knowledge-review/approve': {
      post: {
        tags: ['知识飞轮'],
        summary: '审核通过并入库 RAG',
        description: '将高频问题审核通过，自动向量化后入库到 knowledge_chunks 表，下次 RAG 检索可命中',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer', example: 1 } } },
            },
          },
        },
        responses: {
          200: { description: '已审核通过并入库', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
        },
      },
    },
    '/knowledge-review/reject': {
      post: {
        tags: ['知识飞轮'],
        summary: '拒绝问题',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['id'],
                properties: {
                  id: { type: 'integer', example: 1 },
                  reason: { type: 'string', example: '问题不属于越剧范畴' },
                },
              },
            },
          },
        },
        responses: { 200: { description: '已拒绝', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } } },
      },
    },

    // ========== 系统 ==========
    '/system/health': {
      get: {
        tags: ['系统'],
        summary: '健康检查',
        description: '公开接口，用于负载均衡/监控探针。返回服务状态、运行时长、数据库连通性',
        responses: {
          200: {
            description: '健康状态',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    code: { type: 'integer', example: 0 },
                    data: {
                      type: 'object',
                      properties: {
                        status: { type: 'string', enum: ['healthy', 'degraded'], example: 'healthy' },
                        healthy: { type: 'boolean', example: true },
                        uptime_human: { type: 'string', example: '2小时15分钟' },
                        database: { type: 'object', properties: { connected: { type: 'boolean' }, latency_ms: { type: 'integer' } } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/system/status': {
      get: {
        tags: ['系统'],
        summary: '完整系统状态',
        description: '教师专用。返回服务器信息、资源占用、数据库表统计、请求统计、日志统计',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: '系统状态', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
          403: { description: '非教师角色' },
        },
      },
    },
    '/system/logs': {
      get: {
        tags: ['系统'],
        summary: '日志统计',
        description: '教师专用。返回日志计数、错误数、最后错误、请求统计。支持 ?reset=1 重置统计',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'reset', in: 'query', schema: { type: 'string', enum: ['0', '1'] }, description: '传 1 重置所有统计' },
        ],
        responses: { 200: { description: '日志统计', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } } },
      },
    },

    // ========== 课程 ==========
    '/course': {
      get: {
        tags: ['课程'],
        summary: '课程列表',
        description: '教师返回自己创建的课程，学生返回已加入的课程',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: '成功', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } } },
      },
      post: {
        tags: ['课程'],
        summary: '创建课程（教师）',
        security: [{ BearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' }, subtitle: { type: 'string' }, description: { type: 'string' } } } } } },
        responses: { 200: { description: '创建成功' } },
      },
    },

    // ========== 知识图谱 ==========
    '/kg/entities': {
      get: {
        tags: ['知识图谱'],
        summary: '实体列表',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: '成功' } },
      },
    },
    '/kg/search': {
      get: {
        tags: ['知识图谱'],
        summary: '语义搜索实体',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: '成功' } },
      },
    },
  },
};

// Swagger UI 选项
const swaggerOptions = {
  customCss: `
    .swagger-ui { font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; }
    .swagger-ui .topbar { background-color: #c1272d; }
    .swagger-ui .info .title { color: #1a1a1a; font-weight: 600; }
    .opblock-tag { color: #1a1a1a !important; }
    .opblock-tag-section .opblock-tag { border-bottom-color: #c1272d !important; }
  `,
  customSiteTitle: '越韵智传 API 文档',
  customfavIcon: '/favicon.ico',
};

router.use('/', swaggerUi.serve, swaggerUi.setup(openapiSpec, swaggerOptions));

export default router;
