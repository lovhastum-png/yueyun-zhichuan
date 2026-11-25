// 知识图谱实体类型元数据（标签 + 配色），课程精读图谱与全局图谱共用
export const KG_TYPE_LABELS: Record<string, string> = {
  person: '人物',
  school: '流派',
  play: '剧目',
  role: '行当',
  segment: '唱段',
  concept: '概念',
};

export const KG_TYPE_COLORS: Record<string, string> = {
  person: '#c1272d',
  school: '#3a7d7b',
  play: '#a67c52',
  role: '#8b4513',
  segment: '#d4a574',
  concept: '#1a1a1a',
};
