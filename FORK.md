# moonfruit/zashboard fork

在 [Zephyruso/zashboard](https://github.com/Zephyruso/zashboard) 之上维护的自有版本。

## 分支

| 分支        | 内容                          | 更新方式                        |
| ----------- | ----------------------------- | ------------------------------- |
| `main`      | 上游 `main` 的镜像            | 只快进，不提交                  |
| `upstream`  | 上游最新 release tag          | 只快进，不提交                  |
| `moonfruit` | 发行分支：上游版本 + 自有补丁 | 合并 `upstream`、`feat/*` 的 PR |
| `feat/*`    | 新特性                        | 从 `moonfruit` 拉出             |

- 上游只在发版后合入 `moonfruit`。上游未发版的紧急修复用 `git cherry-pick -x` 先挑进来。
- 同步 PR 必须用 **Create a merge commit** 合并；squash / rebase 会丢掉上游祖先，下次同步会冲突。
- 想回馈上游的改动从 `main` 拉分支。

## 减少冲突的约定

- 新代码尽量放新文件，上游文件只加最少的挂载点。
- 不改 release-please 管理的文件：`CHANGELOG.md`、`package.json` 的 `version`。
- `pnpm-lock.yaml` 冲突时取上游版本后重新 `pnpm i`。
- 不对上游文件做格式化或无关重构。

## 版本

版本号为 `<上游版本>-moonfruit.<N>`，tag 如 `v3.29.1-moonfruit.1`。`package.json` 保持上游版本，构建时通过环境变量注入：

- `APP_VERSION`：覆盖显示的版本号，同时隐藏 commit id
- `APP_REPO`：UI 更新检查和设置页链接使用的 GitHub 仓库，本分支默认 `moonfruit/zashboard`（上游默认 `Zephyruso/zashboard`）

## 面板升级

面板只负责检查：比较 `https://api.github.com/repos/<APP_REPO>/releases/latest` 的 `tag_name` 与当前版本，不同即提示更新。真正的下载由 mihomo 按自身的 `external-ui-url` 完成，所以要让“升级面板”装上本 fork，mihomo 配置需指向本仓库：

```yaml
external-ui: ui
external-ui-url: https://github.com/moonfruit/zashboard/releases/latest/download/dist.zip
# 或无字体版：.../releases/latest/download/dist-no-fonts.zip
```

## 工作流

| 工作流              | 触发                      | 作用                                                                    |
| ------------------- | ------------------------- | ----------------------------------------------------------------------- |
| `fork-ci.yml`       | 推送 / PR 到 `moonfruit`  | type-check、lint、build                                                 |
| `sync-upstream.yml` | 每 6 小时、手动           | 快进 `main` 和 `upstream`，上游发版后开 PR 合入 `moonfruit`，冲突则失败 |
| `fork-release.yml`  | 在 `moonfruit` 上手动运行 | 自动编号，发布 Release（`dist.zip`、`dist-no-fonts.zip`）并部署 Pages   |
| `deploy.yml`        | 上游的发布流程            | 在 fork 中已禁用                                                        |

`sync-upstream.yml` 需要 `SYNC_TOKEN` secret：仅授权本仓库的 fine-grained PAT，权限为 Contents、Pull requests、Workflows 读写。

## 手动同步

```bash
git remote add zephyruso https://github.com/Zephyruso/zashboard.git
git remote set-url --push zephyruso DISABLED

git fetch zephyruso --tags
TAG=$(git tag -l 'v*' --sort=-v:refname | rg '^v\d+\.\d+\.\d+$' | head -1)
git switch main && git merge --ff-only zephyruso/main && git push
git switch upstream && git merge --ff-only "${TAG}" && git push
git switch moonfruit && git merge upstream
pnpm i && pnpm type-check && pnpm build
git push
```

不要 `git push --tags`，否则会把上游的全部 tag 推到 fork。
