// 知识图谱路由
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { success, fail, asyncHandler } from '../middleware/error.js';
import {
  getKgStats,
  getGraphData,
  searchEntities,
  getEntityNeighbors,
  getEntityDetail,
} from '../services/kgService.js';

const router = Router();
router.use(authRequired);

// 图谱统计概览
router.get('/stats', asyncHandler(async (req, res) => {
  const stats = await getKgStats();
  return success(res, stats);
}));

// 获取图谱数据（cytoscape.js elements 格式）
router.get('/graph', asyncHandler(async (req, res) => {
  const { types, max } = req.query;
  const entityTypes = types ? types.split(',').filter(Boolean) : null;
  const maxEntities = Math.min(parseInt(max) || 100, 300);
  const data = await getGraphData({ entityTypes, maxEntities });
  return success(res, data);
}));

// 搜索实体
router.get('/search', asyncHandler(async (req, res) => {
  const { q } = req.query;
  if (!q) return fail(res, '请提供搜索关键词', 400, 400);
  const results = await searchEntities(q);
  return success(res, results);
}));

// 实体邻居子图
router.get('/entity/:id/neighbors', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return fail(res, '无效的实体ID', 400, 400);
  const data = await getEntityNeighbors(id);
  if (!data) return fail(res, '实体不存在', 404, 404);
  return success(res, data);
}));

// 实体详情
router.get('/entity/:id', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return fail(res, '无效的实体ID', 400, 400);
  const detail = await getEntityDetail(id);
  if (!detail) return fail(res, '实体不存在', 404, 404);
  return success(res, detail);
}));

export default router;
