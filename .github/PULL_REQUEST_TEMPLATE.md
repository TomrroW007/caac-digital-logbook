这是什么类型的变更？(What type of change is this?)
- [ ] ✨ 新功能 (Feature)
- [ ] 🐛 Bug 修复 (Bug Fix)
- [ ] ♻️ 代码重构 (Refactor)
- [ ] ✅ 增加/修改测试 (Test Update)
- [ ] 🔧 构建/杂项 (Chore)
- [ ] 📝 文档更新 (Docs)

## 变更描述 (What & Why)
请简短说明本次 PR 修改了什么内容以及为什么需要这些修改。
(Please briefly describe what this PR changes and why it's necessary.)


## 测试覆盖 (Test Coverage)
涉及的测试文件 (Affected test files) / 是否新增了用例 (Added new test cases?):
- 

## 业务规则确认 Checklist (Business Rules Verification)
- [ ] 若修改了时间计算逻辑，是否同步更新了 `TimeCalculator.test.ts` / `FlightMath.test.ts`？
- [ ] 若修改了合规校验逻辑，是否同步更新了 `ComplianceValidator.test.ts`？
- [ ] 若新增/修改了 WatermelonDB Schema，是否在 `migrations/index.ts` 中追加了新的迁移步骤（绝不修改已有步骤）？
- [ ] 若修改了 API 交互逻辑，时间轴字段（OFF/TO/LDG/ON）是否严格保持 "SME 红线：不允许 API 自动覆盖"？

## 自测清单 (Self-Test Checklist)
- [ ] `npm run typecheck` 通过 (Passed typecheck)
- [ ] `npm test` 全绿通过 (All tests passed)
- [ ] 测试覆盖率未低于阈值（branches 80% / 其他 90%） (Coverage meets thresholds)

## 截图 / 录屏 (Screenshots / Screen Recording)
_如有 UI 变更，请在此附上对比截图 / If there are UI changes, attach screenshots here._
