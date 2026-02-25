# Changelog

## [0.6.5](https://github.com/pi-ohm/pi-ohm/compare/subagents-v0.6.4...subagents-v0.6.5) (2026-02-25)


### Features

* changesets/publishing ([b82da81](https://github.com/pi-ohm/pi-ohm/commit/b82da81f08f4060ad9cd729af47b15c4117e4ab1))
* **config,subagents:** add batched task start orchestration with bounded concurrency ([10e3194](https://github.com/pi-ohm/pi-ohm/commit/10e3194b51611bc286e4ceb0d4c6d790a951f54c))
* **config,subagents:** add interactive-sdk backend spike ([0dbbd72](https://github.com/pi-ohm/pi-ohm/commit/0dbbd72842cb50c9e2497ef9b61f74a3154e0c01))
* **config,subagents:** add per-subagent model overrides ([60b736e](https://github.com/pi-ohm/pi-ohm/commit/60b736e0d768db2ed53383c9b907c1967005346a))
* **config,subagents:** add task permission policy controls and hardened lifecycle error surface ([9a94709](https://github.com/pi-ohm/pi-ohm/commit/9a9470931b7c8f939a53845d234ace9b8508d651))
* **config,subagents:** add typebox schema parsing for subagent profile config ([9d99d8b](https://github.com/pi-ohm/pi-ohm/commit/9d99d8b2ed1e7b04053377e04b2d591deb16bbf6))
* **config,subagents:** add wildcard variant subagent profiles and file prompt loading ([2e85f2e](https://github.com/pi-ohm/pi-ohm/commit/2e85f2e7412c46c98cd35feeab256559c4b383ef))
* **core,subagents:** error types with better-result ([d93dedf](https://github.com/pi-ohm/pi-ohm/commit/d93dedfa6634201ebb0c487e85c9bb2f090d7241))
* nice ([32a797c](https://github.com/pi-ohm/pi-ohm/commit/32a797c225b099d6b375a6d8ec9c70a2c16b2cee))
* **repo,core,config,modes,handoff,subagents,session-search,painter,tui,pi-ohm:** migrate publish pipeline to tsdown dist artifacts ([0e8e307](https://github.com/pi-ohm/pi-ohm/commit/0e8e307ed19938965d1e5bd535eb8eccf7aa9b98))
* **subagents,prompts:** variant scaffolding, prompts, catalog ([c214423](https://github.com/pi-ohm/pi-ohm/commit/c214423b415fc23b18d1d9a7645d4e6227913704))
* **subagents,root,repo:** replace sticky runtime rows with amp-style tree widget ([6288092](https://github.com/pi-ohm/pi-ohm/commit/6288092f323c1ce718213060576c0e0b2cdc5bee))
* **subagents,root:** add task tool mvp with backend + tests ([a5d1996](https://github.com/pi-ohm/pi-ohm/commit/a5d19963a3653d2c29cf460973726fc2b2fcc42b))
* **subagents:** add async throughput guardrails for task runtime ([91820ce](https://github.com/pi-ohm/pi-ohm/commit/91820ce9d15971941f745d9965c7445723113d05))
* **subagents:** add config-driven prompt profile rules and runtime model switch demo ([6e08e95](https://github.com/pi-ohm/pi-ohm/commit/6e08e95d9ad53b848539f812707412b71cb5adf4))
* **subagents:** add deterministic output truncation metadata to task result payloads ([f0bd2e9](https://github.com/pi-ohm/pi-ohm/commit/f0bd2e96d4157cb1dbdd3c0db4c5ad08561986eb))
* **subagents:** add live task runtime presentation for footer, widget, and headless updates ([6541b77](https://github.com/pi-ohm/pi-ohm/commit/6541b77f2e91cbbc4c2e0e88d5e6f9d3f02e0097))
* **subagents:** add model-truth prompt profile precedence and selection diagnostics ([92c031f](https://github.com/pi-ohm/pi-ohm/commit/92c031fdd6177e66ce5cbc61c863f3e623dab209))
* **subagents:** add optional sdk to cli fallback policy ([694fdce](https://github.com/pi-ohm/pi-ohm/commit/694fdce60586c5eaf802089505fc8e0406cb1d50))
* **subagents:** add primary schema specialization and align lifecycle observability aggregation ([9edf3a4](https://github.com/pi-ohm/pi-ohm/commit/9edf3a40080cc3febc8cf146cd664a5cf31c1fdf))
* **subagents:** add provider-aware sdk system prompts for anthropic/openai/google/moonshot ([6fa253d](https://github.com/pi-ohm/pi-ohm/commit/6fa253d2230d4a766ac4520461333491223b179a))
* **subagents:** add sdk event ADT and boundary parsing ([8bfb49e](https://github.com/pi-ohm/pi-ohm/commit/8bfb49e7439bb6c3b6fbfc9c3f7df5b094f5f5b0))
* **subagents:** add sprint4 send + persistence runtime ([7ef411d](https://github.com/pi-ohm/pi-ohm/commit/7ef411dab28e54a02e8712fb0abe0781dfd85c97))
* **subagents:** capture sdk stream lifecycle events ([fd514e4](https://github.com/pi-ohm/pi-ohm/commit/fd514e4a9bc2d90082aeffed84913ed485b0c382))
* **subagents:** close H1/H6 demo coverage and H7 rollout docs ([db96d88](https://github.com/pi-ohm/pi-ohm/commit/db96d881c64a9583fbe03c6be93a7acde214b59c))
* **subagents:** collapse task history output with ctrl+o expandable preview ([a733a0f](https://github.com/pi-ohm/pi-ohm/commit/a733a0f7726add860859cd095d02fc1bb2f83660))
* **subagents:** default to inline progress and simplify async background updates ([b6a0059](https://github.com/pi-ohm/pi-ohm/commit/b6a0059a7716a21c48adfa48975c326824ad9833))
* **subagents:** expose terminal task outputs in async status and wait item payloads ([26683f4](https://github.com/pi-ohm/pi-ohm/commit/26683f470e733c0fb732c4d165d32ee66b514887))
* **subagents:** harden task lifecycle ergonomics and observability contract ([351ebf6](https://github.com/pi-ohm/pi-ohm/commit/351ebf6de03c2283777e2ac1b8f9212494ef9d61))
* **subagents:** implement sprint3 task lifecycle ops + runtime store ([553c3c2](https://github.com/pi-ohm/pi-ohm/commit/553c3c2046455bea17650556e8d0c65e371fa6f9))
* **subagents:** include extended catalog metadata in tool descriptions ([c4cdac2](https://github.com/pi-ohm/pi-ohm/commit/c4cdac2cf078f8ff6721d3a78d8a848d39f66b0d))
* **subagents:** make prompt profile model matchers configurable via env json overrides ([7bb3474](https://github.com/pi-ohm/pi-ohm/commit/7bb34741dbbbf0053ba82947261a137ca77226d8))
* **subagents:** modularize system prompt packs and add profile observability tracing ([089fa71](https://github.com/pi-ohm/pi-ohm/commit/089fa71f65a3a0e73c3887587365fd0fb7b28d2c))
* **subagents:** normalize backend identity and add stable task result contract marker ([ca51f53](https://github.com/pi-ohm/pi-ohm/commit/ca51f5370f52ee05aa4c339a9139ae2e81a6fc42))
* **subagents:** persist bounded task event timelines ([2be7ca4](https://github.com/pi-ohm/pi-ohm/commit/2be7ca49eebe2a9ec8fff7de1b4e5b69b27418e5))
* **subagents:** phase1 sticky status baseline for interactive task runtime ([512f059](https://github.com/pi-ohm/pi-ohm/commit/512f059a5838d7967d1431a09d6cc8d8b1085ad4))
* **subagents:** phase2 add throttled compact live task widget coordinator ([b5dea87](https://github.com/pi-ohm/pi-ohm/commit/b5dea878419b39c13252a22bb5ad8feac6aada0b))
* **subagents:** phase3 gate interactive onUpdate to lifecycle transitions ([8cf950c](https://github.com/pi-ohm/pi-ohm/commit/8cf950c5cd64c434fae6a5855b06ab7581b0e4c4))
* **subagents:** phase4 add live UI mode command and mode-aware coverage ([4415009](https://github.com/pi-ohm/pi-ohm/commit/441500956b37be0f2cb0c0d3d68570a89304d871))
* **subagents:** polish tui ([88919e0](https://github.com/pi-ohm/pi-ohm/commit/88919e0011d1fe0fad4e8e1580c17f82418684b6))
* **subagents:** register primary profile tools with shared task runtime semantics ([b81516a](https://github.com/pi-ohm/pi-ohm/commit/b81516a140d3aa9772715830c7adb3ed4cf82d74))
* **subagents:** render inline results from structured assistant events ([a003fe2](https://github.com/pi-ohm/pi-ohm/commit/a003fe2bee576c65f933fc00e9e49d1ade983050))
* **subagents:** render inline task results as amp-style message trees ([05f2d77](https://github.com/pi-ohm/pi-ohm/commit/05f2d77e582d8af1f0b41159c563f6ee2c79b128))
* **subagents:** scaffold schema ([66e588f](https://github.com/pi-ohm/pi-ohm/commit/66e588ff486707912230c7f4d78d7c6731066b36))
* **subagents:** scaffold schema/invocation ([42820ad](https://github.com/pi-ohm/pi-ohm/commit/42820ad9f641e65c61f6d5f76535be952509e906))
* **subagents:** show loaded model + thinking in subagent detail command ([d3193d8](https://github.com/pi-ohm/pi-ohm/commit/d3193d8742ddbd678b664c0d5bc3b1b283da3547))
* **subagents:** start dynamic model-scope prompt routing from pi settings ([37178a9](https://github.com/pi-ohm/pi-ohm/commit/37178a9c3bc21aeecd75c354e4b029049e44e5e2))
* **subagents:** stream prompt routing debug metadata during running updates ([f8fd7ed](https://github.com/pi-ohm/pi-ohm/commit/f8fd7edea39b83136ce0ebb84ef1ec5775819dc1))
* **subagents:** support :thinking in model override patterns ([0a311cf](https://github.com/pi-ohm/pi-ohm/commit/0a311cfb83c48067c5d645b730773a04191d5c75))
* **subagents:** switch task history to embedded transcript format with debug gating ([0f3e98a](https://github.com/pi-ohm/pi-ohm/commit/0f3e98a0669376766aead3c496bd8d1f4ee8105e))
* **subagents:** update built-in subagent catalog ([85494ab](https://github.com/pi-ohm/pi-ohm/commit/85494abffc7dff29c4fe371d4b46dd87ebce1430))


### Bug Fixes

* add repository metadata to publishable packages ([9e7bb43](https://github.com/pi-ohm/pi-ohm/commit/9e7bb435ccaa14fdd0e70326e9b000b7222e3c6b))
* add repository metadata to publishable packages ([dc791ad](https://github.com/pi-ohm/pi-ohm/commit/dc791ade07e565fc297e398b367cd1cb4b13f2d8))
* **config,subagents:** honor higher-precedence subagent variant matches ([e506d55](https://github.com/pi-ohm/pi-ohm/commit/e506d556c300760dabf54a50dca94989ed345b14))
* **core,db,subagents:** centralize XDG data-home resolution under pi-ohm ([15884cf](https://github.com/pi-ohm/pi-ohm/commit/15884cfb52126a7479bce832c36549412aae4375))
* **subagents,docs:** harden timeout handling and expose sdk-&gt;cli fallback diagnostics ([ffb1a5c](https://github.com/pi-ohm/pi-ohm/commit/ffb1a5c585a826b4f75d003e35022c86ccb46c55))
* **subagents,docs:** improve oracle timeout handling and backend error diagnostics ([a900dfe](https://github.com/pi-ohm/pi-ohm/commit/a900dfed2360675d21257e0234b2ffacd75a4e90))
* **subagents,docs:** reduce post-run stalls in task finalization ([24b7a8d](https://github.com/pi-ohm/pi-ohm/commit/24b7a8d7b8f8de871312434a1e4792073dd3d287))
* **subagents,tui:** enable compaction of tool calls in tree ([a33f0d5](https://github.com/pi-ohm/pi-ohm/commit/a33f0d5cd9267d8b9728ee42ce5febf30282b8ac))
* **subagents,tui:** fix bolding in tree heading and tool prefixes ([7c4d37a](https://github.com/pi-ohm/pi-ohm/commit/7c4d37a59319495d211065e1855e0b11cae6e9b0))
* **subagents:** actually fix streaming ([eadaacc](https://github.com/pi-ohm/pi-ohm/commit/eadaacc10c3edfa2d97d1b93ff9257d181aba634))
* **subagents:** better streaming ([967479f](https://github.com/pi-ohm/pi-ohm/commit/967479f368a757884eb4b68d6e3da75063089873))
* **subagents:** clear runtime refs on terminal task transitions ([01053bf](https://github.com/pi-ohm/pi-ohm/commit/01053bf2d7ab118dcc8188f5c41bd7639ef73036))
* **subagents:** ctrl+o toggles expanded/collapsed ([c68961d](https://github.com/pi-ohm/pi-ohm/commit/c68961d2b2eefbb2d4dbc49f123d3bb9aaa342d4))
* **subagents:** didn't really fix streaming but ok ([d8fb1f6](https://github.com/pi-ohm/pi-ohm/commit/d8fb1f6e2ac6ec07d3e427455f6502f32fd29836))
* **subagents:** execute task backend via nested pi and normalize lifecycle op payload compatibility ([8646f56](https://github.com/pi-ohm/pi-ohm/commit/8646f56483ea870fb63843682ddfe4db1c3823f5))
* **subagents:** fix batch streaming but now flicker inc is here ([6575c09](https://github.com/pi-ohm/pi-ohm/commit/6575c09cf75deb87c641b39f707047090df2edcd))
* **subagents:** fix master agent message being truncated ([33aeb78](https://github.com/pi-ohm/pi-ohm/commit/33aeb781df6330480e6bc114c5d9197b13ba698b))
* **subagents:** fix tha truncation issues ([039608d](https://github.com/pi-ohm/pi-ohm/commit/039608d49992ded4e4049b49a7b14d0e208394d7))
* **subagents:** fix tui ([746486e](https://github.com/pi-ohm/pi-ohm/commit/746486ec301c5f74d0c344eda0915b9f8387bd32))
* **subagents:** human labels for tools in task tool ([9cd5f8a](https://github.com/pi-ohm/pi-ohm/commit/9cd5f8add061d150e3cd550fb23a51012e8787f0))
* **subagents:** include batch item outputs in model-facing task payload ([bf6a136](https://github.com/pi-ohm/pi-ohm/commit/bf6a13690514089018d3238e6b714ab1a4cc0c44))
* **subagents:** keep non-ui updates model-facing and full-response ([5ae5332](https://github.com/pi-ohm/pi-ohm/commit/5ae53320cd4e5539b6ede682eca916873769e152))
* **subagents:** keep primary profiles concise in task tool roster ([f1bfdc6](https://github.com/pi-ohm/pi-ohm/commit/f1bfdc6cfc42066533e0298d9d94c39358f2c638))
* **subagents:** normalize task tool result text for model consumers ([774688d](https://github.com/pi-ohm/pi-ohm/commit/774688df4189b98a45b6f7e67b41b4c7e887c663))
* **subagents:** persist task registry under XDG data dir ([cb74d62](https://github.com/pi-ohm/pi-ohm/commit/cb74d6273fe93877f5ed13e8e49b254a7aaad5fd))
* **subagents:** pin live runtime above chat and animate task widget frames ([611886e](https://github.com/pi-ohm/pi-ohm/commit/611886e9f8d9722fdc1e394f85f9c89c34dd1439))
* **subagents:** preserve multiline task output in compact result text and lifecycle payloads ([e45e225](https://github.com/pi-ohm/pi-ohm/commit/e45e225d5938fe25526270e68db95b6c9508f676))
* **subagents:** raise oracle default backend timeout to 1h ([e53c4ee](https://github.com/pi-ohm/pi-ohm/commit/e53c4ee74849e810b1ec7746d73285ef6e944097))
* **subagents:** recover persisted running tasks as terminal on startup ([6d4335a](https://github.com/pi-ohm/pi-ohm/commit/6d4335aced43000cc9e786ef1779c5cf0a0b8b45))
* **subagents:** register task tool with object parameter schema ([2f146c5](https://github.com/pi-ohm/pi-ohm/commit/2f146c5a9a13fd52fd0e4ec02a7fde47fae18961))
* **subagents:** render task progress as streaming tool messages instead of footer/widget UI surfaces ([43bf7af](https://github.com/pi-ohm/pi-ohm/commit/43bf7af991598fcac3babe2a4062546a0629cefc))
* **subagents:** resolve built-in prompt files correctly in packaged dist ([a093101](https://github.com/pi-ohm/pi-ohm/commit/a09310147622e767f4065d3a575c41378ec9c3e6))
* **subagents:** show first lines in compact subagent result preview ([e83c930](https://github.com/pi-ohm/pi-ohm/commit/e83c93046f77f44f286b2cd3b835a53d65939916))
* **subagents:** show only active tasks in sticky widget surface ([b1d8f58](https://github.com/pi-ohm/pi-ohm/commit/b1d8f580b9e826768835f698d70b1aeb2360e074))
* **subagents:** show per-item routing metadata for mixed batch debug output ([e557046](https://github.com/pi-ohm/pi-ohm/commit/e5570465edd93b8b0c0b0e826cdf04d126697cc0))
* **subagents:** truncation issues ([301f945](https://github.com/pi-ohm/pi-ohm/commit/301f9451e600caa78b6ebeca881b0ee163c53c57))
* **subagents:** use real task ids in batch model payloads ([09421ef](https://github.com/pi-ohm/pi-ohm/commit/09421ef355e0852d856a6a6e76821cb47b5d489c))
* **tui,subagents:** color status markers and switch running header marker to bullet ([27ef5d6](https://github.com/pi-ohm/pi-ohm/commit/27ef5d6b3c033a27bd02ba3666fe73dc4137e630))
* **tui,subagents:** make subagents look better ([b7cfc25](https://github.com/pi-ohm/pi-ohm/commit/b7cfc250c44312672079d2c50147a1fd9e6732ca))
* **tui,subagents:** remove spinners :( ([a92cba7](https://github.com/pi-ohm/pi-ohm/commit/a92cba7955b74a953e027629775fcebfc09f555c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pi-ohm/config bumped to 0.6.5
    * @pi-ohm/core bumped to 0.6.5
    * @pi-ohm/tui bumped to 0.6.5

## [0.6.4](https://github.com/pi-ohm/pi-ohm/compare/subagents-v0.6.3...subagents-v0.6.4) (2026-02-18)

### Features

- changesets/publishing ([b82da81](https://github.com/pi-ohm/pi-ohm/commit/b82da81f08f4060ad9cd729af47b15c4117e4ab1))
- **core,subagents:** error types with better-result ([d93dedf](https://github.com/pi-ohm/pi-ohm/commit/d93dedfa6634201ebb0c487e85c9bb2f090d7241))
- nice ([32a797c](https://github.com/pi-ohm/pi-ohm/commit/32a797c225b099d6b375a6d8ec9c70a2c16b2cee))
- **subagents:** scaffold schema/invocation ([42820ad](https://github.com/pi-ohm/pi-ohm/commit/42820ad9f641e65c61f6d5f76535be952509e906))
- **subagents:** update built-in subagent catalog ([85494ab](https://github.com/pi-ohm/pi-ohm/commit/85494abffc7dff29c4fe371d4b46dd87ebce1430))

### Bug Fixes

- add repository metadata to publishable packages ([9e7bb43](https://github.com/pi-ohm/pi-ohm/commit/9e7bb435ccaa14fdd0e70326e9b000b7222e3c6b))
- add repository metadata to publishable packages ([dc791ad](https://github.com/pi-ohm/pi-ohm/commit/dc791ade07e565fc297e398b367cd1cb4b13f2d8))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @pi-ohm/config bumped to 0.6.4

## [0.6.3](https://github.com/pi-ohm/pi-ohm/compare/subagents-v0.6.2...subagents-v0.6.3) (2026-02-18)

### Features

- **core,subagents:** error types with better-result ([d93dedf](https://github.com/pi-ohm/pi-ohm/commit/d93dedfa6634201ebb0c487e85c9bb2f090d7241))
- **subagents:** scaffold schema/invocation ([42820ad](https://github.com/pi-ohm/pi-ohm/commit/42820ad9f641e65c61f6d5f76535be952509e906))
- **subagents:** update built-in subagent catalog ([85494ab](https://github.com/pi-ohm/pi-ohm/commit/85494abffc7dff29c4fe371d4b46dd87ebce1430))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @pi-ohm/config bumped to 0.6.3

## [0.6.2](https://github.com/pi-ohm/pi-ohm/compare/subagents-v0.6.1...subagents-v0.6.2) (2026-02-17)

### Features

- changesets/publishing ([b82da81](https://github.com/pi-ohm/pi-ohm/commit/b82da81f08f4060ad9cd729af47b15c4117e4ab1))
- nice ([32a797c](https://github.com/pi-ohm/pi-ohm/commit/32a797c225b099d6b375a6d8ec9c70a2c16b2cee))

### Bug Fixes

- add repository metadata to publishable packages ([9e7bb43](https://github.com/pi-ohm/pi-ohm/commit/9e7bb435ccaa14fdd0e70326e9b000b7222e3c6b))
- add repository metadata to publishable packages ([dc791ad](https://github.com/pi-ohm/pi-ohm/commit/dc791ade07e565fc297e398b367cd1cb4b13f2d8))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @pi-ohm/config bumped to 0.6.2

## [0.6.1](https://github.com/pi-ohm/pi-ohm/compare/subagents-v0.6.0...subagents-v0.6.1) (2026-02-17)

### Features

- changesets/publishing ([b82da81](https://github.com/pi-ohm/pi-ohm/commit/b82da81f08f4060ad9cd729af47b15c4117e4ab1))
- nice ([32a797c](https://github.com/pi-ohm/pi-ohm/commit/32a797c225b099d6b375a6d8ec9c70a2c16b2cee))

### Bug Fixes

- add repository metadata to publishable packages ([9e7bb43](https://github.com/pi-ohm/pi-ohm/commit/9e7bb435ccaa14fdd0e70326e9b000b7222e3c6b))
- add repository metadata to publishable packages ([dc791ad](https://github.com/pi-ohm/pi-ohm/commit/dc791ade07e565fc297e398b367cd1cb4b13f2d8))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @pi-ohm/config bumped to 0.6.1

## [0.6.0](https://github.com/pi-ohm/pi-ohm/compare/subagents-v0.5.0...subagents-v0.6.0) (2026-02-17)

### Features

- changesets/publishing ([b82da81](https://github.com/pi-ohm/pi-ohm/commit/b82da81f08f4060ad9cd729af47b15c4117e4ab1))
- nice ([32a797c](https://github.com/pi-ohm/pi-ohm/commit/32a797c225b099d6b375a6d8ec9c70a2c16b2cee))

### Bug Fixes

- add repository metadata to publishable packages ([9e7bb43](https://github.com/pi-ohm/pi-ohm/commit/9e7bb435ccaa14fdd0e70326e9b000b7222e3c6b))
- add repository metadata to publishable packages ([dc791ad](https://github.com/pi-ohm/pi-ohm/commit/dc791ade07e565fc297e398b367cd1cb4b13f2d8))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @pi-ohm/config bumped to 0.6.0

## [0.5.0](https://github.com/pi-ohm/pi-ohm/compare/v0.4.1...v0.5.0) (2026-02-17)

### Features

- changesets/publishing ([b82da81](https://github.com/pi-ohm/pi-ohm/commit/b82da81f08f4060ad9cd729af47b15c4117e4ab1))
- nice ([32a797c](https://github.com/pi-ohm/pi-ohm/commit/32a797c225b099d6b375a6d8ec9c70a2c16b2cee))

### Bug Fixes

- add repository metadata to publishable packages ([9e7bb43](https://github.com/pi-ohm/pi-ohm/commit/9e7bb435ccaa14fdd0e70326e9b000b7222e3c6b))
- add repository metadata to publishable packages ([dc791ad](https://github.com/pi-ohm/pi-ohm/commit/dc791ade07e565fc297e398b367cd1cb4b13f2d8))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @pi-ohm/config bumped to 0.5.0

## [0.4.1](https://github.com/pi-ohm/pi-ohm/compare/subagents-v0.4.0...subagents-v0.4.1) (2026-02-17)

### Bug Fixes

- add repository metadata to publishable packages ([9e7bb43](https://github.com/pi-ohm/pi-ohm/commit/9e7bb435ccaa14fdd0e70326e9b000b7222e3c6b))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @pi-ohm/config bumped to 0.4.1

## [0.4.0](https://github.com/pi-ohm/pi-ohm/compare/subagents-v0.3.0...subagents-v0.4.0) (2026-02-17)

### Miscellaneous Chores

- **subagents:** Synchronize pi-ohm-lockstep versions

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @pi-ohm/config bumped to 0.4.0

## [0.3.0](https://github.com/pi-ohm/pi-ohm/compare/subagents-v0.2.0...subagents-v0.3.0) (2026-02-17)

### Features

- changesets/publishing ([b82da81](https://github.com/pi-ohm/pi-ohm/commit/b82da81f08f4060ad9cd729af47b15c4117e4ab1))
- nice ([32a797c](https://github.com/pi-ohm/pi-ohm/commit/32a797c225b099d6b375a6d8ec9c70a2c16b2cee))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @pi-ohm/config bumped to 0.3.0
