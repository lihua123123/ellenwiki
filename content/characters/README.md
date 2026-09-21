# 角色资料格式说明（content/characters/*.json）

每个角色一个 JSON 文件，文件名建议用角色名（如 `胡桃.json`）。
放置后无需改代码，构建/开发时自动加载；角色详情页会按 `name` 与产球表中的角色匹配。

## 字段说明

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | **必填**，须与产球表中的角色名一致 |
| `title` | string | 称号（如「雪霁梅香」） |
| `rarity` | number | 稀有度 4 或 5 |
| `description` | string | 角色简介 |
| `skills` | array | 战斗天赋（普攻/战技/爆发），见下 |
| `inherents` | array | 固有天赋：`{ name, description }` |
| `constellations` | array | 命之座：`{ level, name, description }` |

## skills 元素

```json
{
  "id": "attack | skill | burst",
  "type": "普通攻击 | 元素战技 | 元素爆发",
  "name": "天赋名",
  "description": "天赋描述",
  "levels": [{ "label": "一段伤害", "values": ["46.9%", "50.7%", "..."] }]
}
```

- `levels` 为按天赋等级 1~15 排列的数值行，可省略。
- `id` 用于把产球/附着表同步到对应天赋卡片：
  产球表中技能名为「普攻/重击/下落」的行 → `attack`；「E …」→ `skill`；「Q …」→ `burst`；「命座N」→ 对应命之座卡片。

## 示例

参考同目录 `胡桃.json`。
