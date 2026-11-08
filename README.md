# 章鱼装备研究会

章鱼料理研究会（brp）的非官方武器、战斗技能与护甲扩展，兼容 CoC 7版。独立分发，不随 System 默认启用，不表示 Chaosium 官方认可或授权。

## 内容

- `coc-weapons`：37 件武器，包括近战、投掷、手枪、步枪、霰弹枪、冲锋枪与机枪。
- `coc-weapon-skills`：射击（冲锋枪）与射击（机枪）两项补充技能。
- `coc-armour`：5 件常见护甲。
- 27 枚 Game-Icons SVG 图标，全部物品均有图标。

## 使用

1. 下载 Release 中的 `octopus-equipment-0.1.2.zip`（历史版本 0.1.0/0.1.1 的武器数据为扁形旧形状，在当前系统上伤害为 0，请勿使用）。
2. 在「资料库 → 合集包 → 上传合集包」上传 ZIP。
3. 在战役中同时勾选 `coc-weapons`、`coc-weapon-skills`、`coc-armour` 三个包。补充技能与武器应一起启用。
4. 将武器拖到调查员角色卡上，即可在「战斗」页查看技能命中率与伤害，并发起攻击。

`equipStatus` 沿用系统现有行为。火器贯穿已生效（极难成功＝最大武器伤害＋伤害加值＋再掷一次武器骰）；全自动、射程难度、瞄准镜与护甲伤害减免不因安装本包而自动补齐。

## 构建与验证

需要 Node.js 22.12 或更新版本，无第三方 npm 依赖。

```bash
npm run build
npm test
```

构建产物为 `dist/octopus-equipment-<版本>.zip`（仓库自带 `lib/` 两份构建依赖副本，与主仓构建逐字节一致）。连续构建应得到逐字节一致的 ZIP。

## 来源与许可

- 原创构建代码采用 MIT；BRP 相关代码保留 `LICENSE-brp.txt`。
- 图标来自 Game-Icons.net，使用 CC BY 3.0；逐枚署名见 `ATTRIBUTION.md`，许可全文见 `LICENSE-game-icons.html`。
- 规则事实来源和边界见 `content/provenance.json`；第三方规则数据不因代码 MIT 或图标 CC BY 而自动改用这些许可。
- 本包不包含官方 PDF、规则正文、图片、Logo、字体或排版，不宣称“官方”“已授权”或“无授权风险”。
