- # OnBeat — MVP 开发说明（给 Claude Code）

  ## 一句话

  乐队排练时，每个人在自己的手机/平板上看**自己乐器的谱**，由一台设备点"开始"，所有设备按**同一个时钟**同步走到同一小节、同一拍。

  ## MVP 范围（先做这些，别的都不做）

  - 网页应用（PWA），手机浏览器直接打开，不需要装 App
  - 创建/加入"房间"（6 位房间码）
  - 每人选择自己的声部：吉他1 / 吉他2 / 贝斯 / 鼓 / 键盘
  - 任何人可当"主控"：开始、停止、跳到某段、改速度
  - 所有设备同步显示当前段落、小节、拍子，以及当前和弦和下一个和弦
  - 可选：本机节拍器声音（Web Audio 调度）和屏幕闪烁
  - 歌曲数据先用仓库里的 JSON 文件，不做数据库、不做登录

  **不做**：账号系统、在线编辑器、音频伴奏、Guitar Pro 导入、原生 App（都放到后续里程碑）

  ## 技术栈

  - monorepo：`/web`（Vite + TypeScript + React）和 `/server`（Node + `ws`）
  - 共享类型放 `/shared`
  - server 无状态持久化，房间状态只存在内存里
  - server 同一份代码既能部署到云上，也能在排练室的笔记本上本地跑（`npm run server`，手机连笔记本的局域网 IP）

  ## 核心设计：同步模型（最重要，先做对）

  ### 1. 时钟同步

  - 客户端连上后，发 8 次 ping：记录本地发送时间 `c0`，服务器返回 `serverTime`，本地收到时间 `c1`
  - 取 RTT（`c1 - c0`）最小的那次，`offset = serverTime - (c0 + c1) / 2`
  - 之后每 30 秒重新同步一次，平滑更新 offset
  - 本地时间一律用 `performance.now()`，不要用 `Date.now()`
  - `serverNow() = performance.now() + offset`

  ### 2. 播放状态（全房间唯一真相，由 server 广播）

  ```ts
  type PlaybackState = {
    songId: string;
    playing: boolean;
    bpm: number;
    anchorServerTime: number; // 锚点：服务器时间
    anchorBeat: number;       // 锚点时刻对应的拍数（从歌曲开头算，0 起）
    loop?: { startBeat: number; endBeat: number };
  };
  ```

  - 当前拍位置 = `anchorBeat + (serverNow() - anchorServerTime) / (60000 / bpm)`
  - **开始**：server 设置 `anchorServerTime = serverNow + 1500ms`（预留网络传输时间，加一小节预备拍），然后广播
  - **改速度 / 跳段**：在下一个小节线生效，并用新的锚点保证位置连续
  - **新加入的设备**：连上就收到当前 state，直接对齐到当前位置
  - 开始后，设备之间不需要持续通信，各自按本地时钟算位置。只有控制命令需要走网络

  ### 3. 消息协议（JSON over WebSocket）

  - client → server：`join {room, part}`、`ping {c0}`、`cmd {start|stop|seekSection|setBpm|setLoop}`
  - server → client：`pong {c0, serverTime}`、`state PlaybackState`、`members [...]`

  ## 歌曲数据格式

  "骨架"（段落、小节、和弦）所有声部共享，各声部只存自己的细节。

  ```json
  {
    "id": "example-song",
    "title": "示例：C-Am-F-G 循环",
    "bpm": 120,
    "timeSignature": [4, 4],
    "key": "C",
    "sections": {
      "intro":  { "bars": [["C"], ["Am"], ["F"], ["G"]] },
      "verse":  { "bars": [["C"], ["Am"], ["F"], ["G"], ["C"], ["Am"], ["F"], ["G"]] },
      "chorus": { "bars": [["F"], ["G"], ["C"], ["Am"], ["F"], ["G"], ["C"], ["C"]] }
    },
    "form": ["intro", "verse", "chorus", "verse", "chorus", "chorus"],
    "parts": {
      "guitar1": { "label": "吉他1", "default": { "strum": "D-DU-UDU" }, "notes": "主歌轻扫，副歌全扫" },
      "guitar2": { "label": "吉他2", "default": { "pattern": "分解 5-3-2-3" } },
      "bass":    { "label": "贝斯", "default": { "pattern": "根音八分" } },
      "drums":   { "label": "鼓",   "default": { "groove": "基本 8beat" }, "sections": { "chorus": { "groove": "8beat + 镲" } } },
      "keys":    { "label": "键盘", "default": { "pattern": "柱式和弦铺底" } }
    }
  }
  ```

  - 一小节里的多个和弦写成数组，比如 `["C", "G/B"]`，按拍数平分
  - 扫弦记法：每个字符代表一个八分音符，`D`=下扫，`U`=上扫，`-`=空拍
  - 示例歌曲只放和弦和结构，**不要放歌词**（版权）

  ## 乐谱格式策略（两层）

  - **骨架层（自有 JSON，上面那个）**：段落、小节、和弦、扫弦型。所有人都能看，同步只依赖这一层
  - **精确谱层（可选附件）**：每首歌可以附一个 Guitar Pro 文件（.gp/.gp5/.gpx）或 MusicXML 文件，用 **alphaTab** 渲染
    - 一个 GP 文件里包含所有声部，用户选自己的声部后，alphaTab 只渲染对应的 track
    - alphaTab 的播放光标**不使用它自己的播放器计时**，而是每帧用我们的同步时钟算出的位置去设置它的光标/tick 位置
    - 处理反复记号：拍位置 → 小节号的映射，要用展开反复记号之后的播放顺序
    - 支持速度变化：把 `bpm` 扩展为速度图（tempo map），拍 ↔ 时间的换算按分段计算
  - 导入：ChordPro → 骨架层（可以用 ChordSheetJS 解析）；从 GP/MusicXML 自动提取段落标记（markers）和小节数生成骨架
  - 依赖许可证需要在 README 里记录（alphaTab 等）

  ## 节拍器与鼓机（M2.5）

  - 和谱共用同一个同步时钟：声音只是"在某个拍位置触发的事件"

  - 音频调度用 Web Audio 的前瞻调度（lookahead）：每 25ms 预排未来 100ms 内的事件，用 `AudioContext.currentTime` 精确触发，不用 `setTimeout` 直接出声

  - 同步时钟 → 音频时钟的换算：用 `audioContext.getOutputTimestamp()` 建立 `performance.now` 和 `audioContext` 时间的对应关系，并扣除 `outputLatency`

  - 每台设备提供"本机延迟补偿"滑块（±300ms），因为蓝牙耳机延迟很大，并在界面上提示用户用有线耳机

  - 节拍器：重拍和弱拍用不同音色；支持细分（四分/八分/十六分）；支持预备拍；可以只闪屏不出声

  - 鼓机：16 步音序器，每小节一个 pattern，每个段落可以设置不同 pattern，写在歌曲 JSON 的 `drums` 声部里：

    ```json
    "pattern": { "kick": "x...x...x...x...", "snare": "....x.......x...", "hat": "x.x.x.x.x.x.x.x." }
    ```

    采样使用 CC0 授权的单音 WAV（kick/snare/hat/crash/ride/tom），放在 

    ```
    /web/public/kits/
    ```

  - 每台设备有"本机出声"开关：通常只有一台接音箱的设备放鼓机，其他人只看谱或在自己耳机里听 click

  - 段落过渡：鼓机在每个段落最后一小节自动加一个简单的加花（可关闭）

  - 以后再做：用 alphaTab 播放 GP 文件里的鼓轨代替鼓机；通过 Web MIDI 输出到真实鼓机（仅 Chrome 支持）

  ## 界面（每个声部同一套布局）

  - 顶部：歌名、BPM、段落名（如"副歌 2"）、第几小节/第几拍
  - 中间大字：当前和弦，旁边小字显示下一个和弦
  - 本声部细节：吉他显示扫弦型，并逐拍高亮当前位置；鼓显示律动说明
  - 底部：整首歌的段落时间线，可以点击跳转（只有主控可以点）
  - 横竖屏都能用，字号要大，排练时离谱架一米也能看清
  - 屏幕常亮（Wake Lock API，不支持就提示用户）

  ## 测试与验收

  - 单元测试：位置计算、锚点切换（改速度/跳段后位置连续）、时钟 offset 算法
  - 模拟测试：server 加随机 50–300ms 延迟，两个客户端算出的拍位置误差小于 20ms
  - 手动验收：两台手机 + 一台电脑打开同一房间，点开始后三台的拍子闪烁肉眼看同步
  - iOS Safari 必须实测：音频需要用户点一下才能解锁，Wake Lock 需要 HTTPS

  ## 里程碑

  1. **M1 同步核心**：房间、时钟同步、开始/停止、只显示拍子闪烁
  2. **M2 谱显示**：加载 JSON 歌曲，按声部显示和弦和扫弦型
  3. **M2.5 节拍器 + 鼓机**：Web Audio 调度、延迟补偿、16 步鼓机、本机出声开关
  4. **M3 排练控制**：跳段、循环某段、改速度、"从第 X 小节再来"
  5. **M4 内容**：简单的歌曲编辑页、导入 ChordPro、上传 GP/MusicXML 并用 alphaTab 按声部渲染、同步光标
  6. **M5（以后）**：速度图、原生 App + Ableton Link 纯局域网模式、Web MIDI 输出

  ## 给 Claude Code 的工作方式

  - 先做 M1，完成后停下来让我在两台手机上测试，再继续
  - 每个里程碑结束时写清楚怎么在本地运行、怎么在手机上打开
