// logger 工具单元测试
import logger from '../server/utils/logger.js';

describe('logger · 结构化日志工具', () => {
  test('应暴露标准日志方法', () => {
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.success).toBe('function');
    expect(typeof logger.module).toBe('function');
    expect(typeof logger.getStats).toBe('function');
    expect(typeof logger.resetStats).toBe('function');
  });

  test('logger.module() 应返回带相同方法的子 logger', () => {
    const sub = logger.module('TEST');
    expect(typeof sub.info).toBe('function');
    expect(typeof sub.error).toBe('function');
    expect(typeof sub.warn).toBe('function');
  });

  test('getStats 应返回统计对象', () => {
    const stats = logger.getStats();
    expect(stats).toHaveProperty('uptime');
    expect(stats).toHaveProperty('counts');
    expect(stats).toHaveProperty('errors');
    expect(stats).toHaveProperty('startTime');
    expect(typeof stats.uptime).toBe('number');
    expect(stats.counts).toHaveProperty('info');
    expect(stats.counts).toHaveProperty('error');
  });

  test('resetStats 应重置错误和计数', () => {
    // 先记一条错误
    logger.error('测试错误');
    const before = logger.getStats();
    expect(before.errors).toBeGreaterThan(0);

    logger.resetStats();
    const after = logger.getStats();
    expect(after.errors).toBe(0);
    expect(after.counts.error).toBe(0);
  });

  test('调用日志方法不应抛出异常', () => {
    expect(() => logger.info('测试信息')).not.toThrow();
    expect(() => logger.warn('测试警告')).not.toThrow();
    expect(() => logger.error('测试错误')).not.toThrow();
    expect(() => logger.success('测试成功')).not.toThrow();
    expect(() => logger.debug('测试调试')).not.toThrow();
  });

  test('子 logger 调用不应抛出异常', () => {
    const sub = logger.module('SUB');
    expect(() => sub.info('子logger信息', { extra: 'data' })).not.toThrow();
    expect(() => sub.error('子logger错误', new Error('test'))).not.toThrow();
  });

  test('记录 error 应更新 lastError', () => {
    logger.resetStats();
    logger.error('特定错误消息');
    const stats = logger.getStats();
    expect(stats.lastError).not.toBeNull();
    expect(stats.lastError.message).toContain('特定错误消息');
    expect(stats.lastError.time).toBeGreaterThan(0);
  });
});
