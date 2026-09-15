/** 一次性数据清理的版本标记与范围说明 */

export const CLEANUP_VERSION = 1;

export const CLEANUP_SCOPE = [
  { label: '训练记录', detail: '历史训练报告与每组的重量/次数明细' },
  { label: '今日总结', detail: '训练、运动、睡眠、强度、补剂、自由记录（含草稿）' },
  { label: '历史身体数据', detail: '体重、体脂、睡眠、饮水、蛋白等每日数值' },
  { label: '上传的截图', detail: 'Apple Watch / 睡眠截图及其识别结果' },
  { label: '演示与测试数据', detail: '内置示例训练计划' },
  { label: '进行中的训练', detail: '未完成的跟练进度' },
];

export const CLEANUP_KEEP = [
  '目标（更新为：体重 70 kg、体脂率低于 12%）',
  '动作库、训练模板、个人纪录 PR',
  'ChatGPT 分析报告与 PDF 导入记录',
  '主题、单位、安装与更新设置',
];

export const DEFAULT_GOALS = {
  weightKg: 70,
  bodyFatPct: 12,
};
