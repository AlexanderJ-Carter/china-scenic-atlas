# 贡献指南

感谢关注本项目！欢迎提交 Issue 与 Pull Request。

## 开发流程

```bash
npm install
npm run dev         # 本地开发
npm run lint        # ESLint
npm run format      # Prettier 格式化
npm run format:check
npm run build       # 类型检查 + 构建
npm test            # 单元测试
npm run data:validate
npm run e2e         # 端到端冒烟（需本机 Chrome）
```

提交前请确保上述检查通过（与 CI 对齐）。

## 数据贡献

数据类 PR（补充 4A 景区、修正坐标/年份）最受欢迎，请：

1. 修改 `scripts/patches-5a.json` / `scripts/patches-4a.json`（附上 `reason` 与佐证链接）
2. 5A：`npm run data:spots && npm run data:validate`；4A：`npm run data:4a && npm run data:validate`
3. 提交 PR 时说明数据来源（官方公告 / 权威媒体 / 百科并注明链接）

注意：4A 状态会随各省文旅厅公告变化，请提供**现行 4A** 的佐证；已升级 5A 或摘牌的景区会被拒绝。

## 约定

- 提交信息使用 Conventional Commits（`feat:` / `fix:` / `data:` / `docs:` …）
- 代码风格由 ESLint + Prettier 约束，CI 会检查
- 新增交互功能请同步考虑移动端布局

## 行为准则

保持友善与基于事实的讨论；对数据来源有分歧时以官方公告为准。
