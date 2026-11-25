// 收藏路由：添加、列表、删除
import { Router } from 'express';
import pool from '../db.js';
import { authRequired } from '../middleware/auth.js';
import { success, fail, asyncHandler } from '../middleware/error.js';

const router = Router();

router.use(authRequired);

// 添加收藏
router.post('/', asyncHandler(async (req, res) => {
  const { type, targetId, content } = req.body || {};
  if (!type || !['chat', 'image'].includes(type)) {
    return fail(res, '收藏类型无效（仅支持 chat/image）', 400, 400);
  }
  const [exists] = await pool.query(
    'SELECT id FROM favorites WHERE user_id = ? AND item_type = ? AND target_id = ?',
    [req.user.id, type, targetId || 0]
  );
  if (exists.length > 0) {
    return success(res, { id: exists[0].id }, '已收藏');
  }
  const [result] = await pool.query(
    'INSERT INTO favorites (user_id, item_type, target_id, content) VALUES (?, ?, ?, ?)',
    [req.user.id, type, targetId || null, content || null]
  );
  return success(res, { id: result.insertId }, '收藏成功');
}));

// 收藏列表（可按类型筛选）
router.get('/', asyncHandler(async (req, res) => {
  const { type } = req.query;
  const params = [req.user.id];
  let sql = 'SELECT id, item_type, target_id, content, created_at FROM favorites WHERE user_id = ?';
  if (type && ['chat', 'image'].includes(type)) {
    sql += ' AND item_type = ?';
    params.push(type);
  }
  sql += ' ORDER BY created_at DESC LIMIT 100';
  const [rows] = await pool.query(sql, params);

  // 若是图片收藏，关联查询图片地址
  // 必须带上 user_id 过滤：target_id 来自客户端，不校验归属的话
  // 只要收藏他人的图片 id，就能读到别人生成图的提示词与图片地址。
  const imageFavIds = rows.filter(r => r.item_type === 'image' && r.target_id).map(r => r.target_id);
  let imageMap = {};
  if (imageFavIds.length > 0) {
    const [imgs] = await pool.query(
      'SELECT id, image_url, prompt FROM image_history WHERE id IN (?) AND user_id = ?',
      [imageFavIds, req.user.id]
    );
    imageMap = Object.fromEntries(imgs.map(i => [i.id, i]));
  }

  return success(res, rows.map(r => ({
    id: r.id,
    type: r.item_type,
    targetId: r.target_id,
    content: r.content,
    imageUrl: r.item_type === 'image' && r.target_id ? imageMap[r.target_id]?.image_url : null,
    prompt: r.item_type === 'image' && r.target_id ? imageMap[r.target_id]?.prompt : null,
    createdAt: r.created_at,
  })));
}));

// 取消收藏
router.delete('/:id', asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM favorites WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  return success(res, null, '已取消收藏');
}));

export default router;
