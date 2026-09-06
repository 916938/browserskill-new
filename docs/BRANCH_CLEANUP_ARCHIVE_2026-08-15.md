# 分支清理归档记录（2026-08-15）

## 1. 归档目的

记录本次 BrowserSkill fork 的分支整理、PR 合并、远程分支删除、本地引用清理以及 GitButler 基址修复结果，作为后续维护和审计参考。

仓库：`916938/browserskill-new`

## 2. 本次合并结果

### PR #11：智能标签可靠保存

- 来源分支：`feature/reliable-smart-labels`
- 主题：`feat(extension): make smart label updates reliable`
- 功能提交：`016ec1c`
- 合并提交：`4ca7207`
- 合并方式：Merge commit
- 状态：已合并

内容包括：

- 智能标签规范化和 32 字符校验
- Popup 到 Background 的请求/响应式保存流程
- 标签保存中、成功、失败状态
- Popup 断开和重复保存保护
- 中英文界面文案
- 智能标签与多账户管理文档

### PR #12：fork 安装与 Skill 对齐

- 来源分支：`chore/align-fork-installation`
- 主题：`docs: align enhanced fork installation and skill guidance`
- 功能提交：`c10a201`
- 合并提交：`5416ee2`
- 合并方式：Merge commit
- 状态：已合并

内容包括：

- 安装脚本默认仓库切换到 `916938/browserskill-new`
- CLI 自动更新清单和 Release 资产地址切换到 fork
- Cargo repository/homepage 元数据更新
- README、Agent 安装指南和隐私文档归属更新
- 多浏览器、智能标签、Profile 模板安全使用说明
- 根目录和 CLI 内嵌 `SKILL.md` 同步
- `install.sh` 可执行权限恢复为 `100755`
- 保留 `Tencent/BrowserSkill` 的 MIT 上游归因

## 3. 已删除的远程分支

以下分支对应的 PR 已合并，因此从 `916938` 远程删除：

```text
feature/reliable-smart-labels
chore/align-fork-installation
```

删除前均已确认其提交是 `916938/main` 的祖先，不会丢失未合并代码。

## 4. 已清理的本地引用

已删除：

```text
refs/heads/feature/reliable-smart-labels
refs/heads/chore/align-fork-installation
refs/remotes/gb-local/feature/reliable-smart-labels
refs/remotes/gb-local/chore/align-fork-installation
```

同时移除了用于构建独立分支的临时 worktree：

```text
D:/916938/browserskill-fork-alignment
```

## 5. GitButler 基址修复

此前 GitButler 配置仍指向已经删除的旧目标：

```text
refs/remotes/gb-local/chain
```

这会导致：

```text
DefaultTargetNotFound
```

已修复为当前 fork 的主分支：

```text
gitbutler.project.targetref=refs/remotes/916938/main
gitbutler.project.targetcommitid=5416ee2f579ea041e72a822b0ed61ec5aeb41f7a
```

随后执行 `but pull`，GitButler 成功识别并同步 PR #11 和 PR #12 的两个上游合并提交。

## 6. 最终状态

远程和本地 `main` 均指向：

```text
5416ee2 Merge pull request #12 from 916938/chore/align-fork-installation
```

同步检查：

```text
916938/main...main
0  0
```

工作区：

```text
clean
```

相关已合并分支在远程服务器上确认不存在。

## 7. 验证记录

### PR #11

- Rust fmt、clippy、tests：通过
- Frontend lint、typecheck、tests、build：通过
- Node script tests：通过
- 合并状态：`MERGED`

### PR #12

- Rust fmt、clippy、tests：通过
- Frontend lint、typecheck、tests、build：通过
- Node script tests：通过
- `bash -n install.sh`：通过
- `node scripts/render-version-json.test.mjs`：通过
- CLI update 模块测试：24 项通过
- `install.sh` 文件模式：`100755`
- 合并状态：`MERGED`

## 8. 保留的远程分支

未处理以下 `Tencent` 远程分支，因为它们属于上游仓库或仍有独立用途：

- `feat/dsh-plugin`：对应上游仍在开发的 Draft PR
- `assets/pr-81-screenshots`：截图资源分支

本地 `Tencent` 远程跟踪引用此前已清理；不会影响上游服务器分支。

## 9. 后续建议

- 新功能从最新 `main` 创建独立分支。
- PR 合并后及时删除远程和本地功能分支。
- 使用 GitButler 时删除目标分支后同步检查 `gitbutler.project.targetref`，避免残留已不存在的 ref。
- 安装器、自动更新 URL 和 Cargo 元数据发生仓库迁移时，应保持同步更新并保留上游许可证归因。
- 多账户场景使用独立浏览器 Profile；智能标签只作为可读别名，不作为权限边界或唯一主键。
