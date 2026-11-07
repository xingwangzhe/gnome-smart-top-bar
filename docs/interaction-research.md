# 顶栏呼出、输入焦点与显示路径

顶栏呼出需要同时满足两项约束：用户有明确的呼出意图，应用仍能收到本应属于它的输入。[手势逻辑](../logic.js)与[Shell 实现](../extension.js)分别处理动作识别、面板显隐和输入状态。本文面向维护者，说明这些选择的研究依据及验证边界。

下文把论文或协议直接支持的结论称为“来源结论”，把从项目代码读取的行为称为“实现行为”。涉及当前机器显卡显示路径的解释仍是“待验证假设”。论文没有验证本插件的参数，也没有证明左右晃动对所有用户都合适。

## 用连续动作表达呼出意图

有意手势应与普通鼠标移动有可辨别的差别。现有实现要求顶边中的连续交替横移，并在按键、拖拽、动作中断或交互对象变化时清空未完成动作。参数及操作说明由[主 README](../README.md#操作)维护。

下面的论文提供相关交互原则，研究对象包括手机、笔输入和菜单。它们都不是针对 GNOME 自动隐藏顶栏的实验。

| 论文与一手来源 | 来源结论 | 对顶栏设计的启示与边界 |
| --- | --- | --- |
| Ruiz、Li，*DoubleFlip: A Motion Gesture Delimiter for Mobile Interaction*，CHI 2011。DOI [10.1145/1978942.1979341](https://doi.org/10.1145/1978942.1979341)。[作者机构页面](https://research.google/pubs/doubleflip-a-motion-gesture-delimiter-for-mobile-interaction/) | 设计一种区别于日常手机运动的动作，作为有意输入的分隔符，并评价识别和误报。 | 连续、刻意的动作可以帮助区分意图。手机翻转实验的误报率不能直接用于鼠标往返手势。 |
| Grossman 等，*Hover Widgets: Using the Tracking State to Extend the Capabilities of Pen-Operated Devices*，CHI 2006。DOI [10.1145/1124772.1124898](https://doi.org/10.1145/1124772.1124898)。[作者机构页面](https://www.microsoft.com/en-us/research/publication/hover-widgets-using-tracking-state-extend-capabilities-pen-operated-devices/)、[论文原文](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/11/Hover-Widgets-CHI-2006.pdf) | 用悬停轨迹和落笔确认建立与普通笔输入区分的命令层；实验观察到分心错误方面的改善。 | 普通经过顶边与主动呼出应有区分。该实验没有验证当前手势阈值，也没有比较本插件与常规顶栏。 |
| Accot、Zhai，*Beyond Fitts’ Law: Models for Trajectory-Based HCI Tasks*，CHI 1997。DOI [10.1145/258549.258760](https://doi.org/10.1145/258549.258760)。[作者机构页面](https://research.google/pubs/beyond-fitts-law-models-for-trajectory-based-hci-tasks/) | 轨迹操作的完成时间与路径长度、宽度有关，论文提出并实验研究 steering law。 | 收窄感应区域或延长动作会增加操作成本。这里的启示是保留可调参数和耗时评价，不能据此算出本插件的最佳阈值。 |
| Kurtenbach、Buxton，*User Learning and Performance with Marking Menus*，CHI 1994。DOI [10.1145/191666.191759](https://doi.org/10.1145/191666.191759)。[作者提供的全文](https://www.billbuxton.com/MMUserLearn.html) | 显示菜单与记忆动作可以共存；熟练用户仍会回到菜单来恢复对布局的记忆。 | 保留可发现的说明、概览和快捷键。动作熟练度不能成为删除可见入口的依据。 |

确定性测试能够检查动作规则，例如一次往返不触发、完整动作触发、离开顶边清零。它不能给出真实用户的日常误触率。维护者若调整默认阈值，需要分别测量普通操作轨迹中的误报、有意手势的成功率及完成时间；键盘用户和动作受限用户也需要可用入口。

## 键盘焦点与鼠标命中分别验收

应用保持激活，并不保证鼠标事件到达应用。透明覆盖层可以接走点击，同时保持原应用的键盘焦点。只有键盘焦点和鼠标命中各自有证据，才能判断顶栏是否干扰应用。

Wayland 的 `wl_keyboard.enter` 表示键盘焦点进入某个表面，`wl_pointer.enter` 表示指针焦点进入某个表面。`wl_surface.set_input_region` 定义接收指针和触摸事件的区域，区域外的事件继续尝试堆叠中的下一个表面。见[官方核心协议](https://wayland.freedesktop.org/docs/html/apa.html#protocol-spec-wl_surface-request-set_input_region)。

GNOME 的 API 也把两项职责分开：[`Clutter.Actor.reactive`](https://mutter.gnome.org/clutter/property.Actor.reactive.html)控制事件相关信号，[`Clutter.Stage.set_key_focus()`](https://mutter.gnome.org/clutter/method.Stage.set_key_focus.html)指定键盘事件接收者。事件处理返回 [`EVENT_STOP`](https://mutter.gnome.org/clutter/const.EVENT_STOP.html)会停止传播，返回 [`EVENT_PROPAGATE`](https://mutter.gnome.org/clutter/const.EVENT_PROPAGATE.html)则继续传播。

XDG Activation 处理的是应用窗口激活请求。[协议](https://gitlab.freedesktop.org/wayland/wayland-protocols/-/blob/main/staging/xdg-activation/xdg-activation-v1.xml)允许 compositor 根据输入序号、来源和 token 判断是否接受请求。[GNOME 官方说明](https://blogs.gnome.org/shell-dev/2024/09/20/understanding-gnome-shells-focus-stealing-prevention/)解释了防止意外键盘焦点转移的目的。GNOME Shell 扩展运行在 compositor 内部，客户端的激活 token 机制不能替它证明顶边输入区域安全。

实现没有增加可响应输入的顶边感应条。`_pollPointer()`被动读取位置，`_show()`移动裁剪区域中的面板内容，保留原生面板容器的位置。隐藏时的要求是让应用收到顶边输入；显示后，面板覆盖区域中的点击应由面板接收。把点击穿透给下面的应用也会造成误操作。

## 菜单与交互上下文

已打开的菜单需要保持可操作，未完成的呼出动作则应随交互上下文失效。实现中的 `_heldOpen()`检查面板菜单、面板键盘焦点和拖拽；`_pollPointer()`在其他模态交互或抓取期间清空手势。焦点窗口变化和窗口的 `user_time` 变化也会重置动作，避免把先前的部分手势接到另一项操作上。

同类开源项目给出了可检查的实现依据。以下固定版本代码说明需要考虑哪些状态，不等同于这些状态在所有桌面组合上都已得到验证。

| 固定版本源码 | 处理方式 | 本项目维护时需要保留的约束 |
| --- | --- | --- |
| [Dash to Dock 的 dwell 检查](https://github.com/ubuntu/dash-to-dock/blob/2dfae3474d6984b566ef0c3dab1524a675bbba48/docking.js#L1046) | 在触发前检查模态计数和焦点窗口的 `user_time`。 | 用户已开始点击、输入或处理模态对话框时，不能继续完成旧的呼出意图。 |
| [Dash to Dock 的菜单关闭处理](https://github.com/ubuntu/dash-to-dock/blob/2dfae3474d6984b566ef0c3dab1524a675bbba48/docking.js#L848) | 菜单打开时保留状态，关闭后同步悬停并重新计算显隐。 | 菜单生命周期会影响悬停状态，不能只看一次坐标或离开事件。 |
| [Dash to Panel 的抓取来源检查](https://github.com/home-sweet-gnome/dash-to-panel/blob/c3aed934f927852a9ec28103e788d1954034bf4c/src/intellihide.js#L499) | 检查当前 grab 的来源是否属于面板或其菜单。 | 面板自身的合法抓取与其他界面的模态抓取应分别处理。 |
| [Hide Top Bar 的菜单快捷键处理](https://github.com/tuxor1337/hidetopbar/blob/493fb7134d4a015ac759ca41f2ef21dd1173aa02/panelVisibilityManager.js#L229)与[菜单保持逻辑](https://github.com/tuxor1337/hidetopbar/blob/493fb7134d4a015ac759ca41f2ef21dd1173aa02/panelVisibilityManager.js#L279) | 先显示面板并等待重新命中，再打开快捷键菜单；菜单打开期间保持显示。 | 面板显示、指针重新命中与菜单抓取有先后关系，测试需要覆盖菜单切换和关闭。 |

真正全屏沿用 Mutter 的原生面板显隐。进入全屏时，验收要求 Shell 菜单和面板键盘焦点不残留，应用顶部菜单仍能接收点击。实现是否需要显式关闭菜单，应由实际行为和测试决定；不能仅因源码没有手动 `ungrab` 就断言存在错误，也不能靠隐藏面板图形推断抓取已释放。

## 指针锁定属于独立状态

游戏可以锁定指针位置，或把指针限制在一个区域内。[pointer-constraints 官方协议](https://gitlab.freedesktop.org/wayland/wayland-protocols/-/blob/main/unstable/pointer-constraints/pointer-constraints-unstable-v1.xml)规定，指针锁定时普通 `wl_pointer.motion` 停止发送，相对运动仍可继续。鼠标滚轮和按钮事件也有各自的递送规则。

插件不得为识别呼出手势而解除应用的指针锁定。当前真全屏策略停止手势采样和备用呼出，避免在这类交互上增加顶边入口。无边框窗口化游戏如果未报告全屏，仍按普通窗口策略处理，限制见[主 README](../README.md#实现与验证)。软件渲染的 GTK 测试没有覆盖真实游戏的全部锁定和显卡组合。

## 直接扫描输出仍需硬件验证

画面未显示但仍能点击，可能来自合成显示路径，也可能来自坐标、悬停或抓取状态。仅凭症状无法确定当前机器的根因。

Hide Top Bar 的[修复提交](https://github.com/tuxor1337/hidetopbar/commit/35194cb0a5ec71d2e0d57fa2cd21fe6cdc840f11)记录了一种接近的情形：移除顶部保留空间后，覆盖整屏的应用可能进入直接扫描输出路径；面板显示动画结束后不可见，但输入区域仍存在。该提交在显示面板时禁止 unredirect，并在完全隐藏或禁用时成对释放。其[固定版本实现](https://github.com/tuxor1337/hidetopbar/blob/493fb7134d4a015ac759ca41f2ef21dd1173aa02/panelVisibilityManager.js#L151)保留了这一计数保护。

本项目 `_holdCompositing()`和`_releaseCompositing()`采用成对保护：面板显示时要求合成，隐藏完成和扩展禁用时释放。代价是面板显示期间限制直接扫描输出机会。这个实现有同类修复作为依据；当前机器的故障是否确由同一路径造成，仍需要真实显卡上的复现、对照和显示路径证据。

维护者不能用无头软件渲染测试通过来宣布硬件根因已证实。硬件验证应同时记录面板可见性、实际鼠标命中、应用焦点和 compositor 显示路径，再比较启用与不启用合成保护时的症状。若画面已经恢复但顶边仍拦截输入，应继续检查输入区域和菜单抓取。

## 自动验收不变量

[Shell 集成测试](../tests/smoke-app.js)通过私有 Mutter 会话注入真实输入，并同时观察 GTK 客户端与扩展状态。运行方式、版本矩阵和产物由[CI 说明](../ci/README.md)维护；本节只定义这些断言各自要防止的问题。

| 场景 | 需要成立的不变量 |
| --- | --- |
| 完成手势、显示后悬停、继续晃动、再次隐藏 | 原 Meta 焦点窗口与 GTK 激活状态保持一致，测试键盘标记恰好递送给应用一次。 |
| 顶栏隐藏 | 应用收到屏幕顶部的点击，不能有不可见感应条拦截。 |
| 顶栏已经呼出 | 覆盖区域中的点击不穿透给应用；指针在面板内移动时不因隐藏延迟而消失。 |
| 快速设置展开 | 指针移出面板后菜单仍可操作；关闭菜单后重新计算显隐，应用恢复正常输入。 |
| 真正全屏 | 手势与备用快捷键均不呼出，应用顶部菜单仍可点击，应用键盘输入保持正常。 |
| 菜单打开期间进入真正全屏 | Shell 不留下不可见菜单抓取或面板键盘焦点；应用能收到顶部点击与测试按键。 |
| 工作区切换或禁用再启用 | 不沿用旧的部分手势；面板显隐和顶部保留空间匹配当前窗口状态。 |

真实用户误触率、真实多屏热插拔、游戏指针锁定和硬件直接扫描输出需要各自的外部证据。维护者应把这些证据与确定性 CI 结果分开记录。
