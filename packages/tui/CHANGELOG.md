# Changelog

## [1.0.0](https://github.com/pi-ohm/pi-ohm/compare/tui-v0.6.4...tui-v1.0.0) (2026-06-22)


### ⚠ BREAKING CHANGES

* **root:** migrate to vite plus

### Features

* **goal,subagents,tui:** hell yeah ([1df3d33](https://github.com/pi-ohm/pi-ohm/commit/1df3d33d9346c6552f7c4983644a1dc0a7a329bc))
* **repo,core,config,modes,handoff,subagents,session-search,painter,tui,pi-ohm:** migrate publish pipeline to tsdown dist artifacts ([0e8e307](https://github.com/pi-ohm/pi-ohm/commit/0e8e307ed19938965d1e5bd535eb8eccf7aa9b98))
* **root:** migrate to vite plus ([126299d](https://github.com/pi-ohm/pi-ohm/commit/126299d94d04bb833a253c0316260b4a0fbfe5f1))
* **subagents,root,repo:** replace sticky runtime rows with amp-style tree widget ([6288092](https://github.com/pi-ohm/pi-ohm/commit/6288092f323c1ce718213060576c0e0b2cdc5bee))
* **tui:** add ohm config panel ([a073403](https://github.com/pi-ohm/pi-ohm/commit/a073403a94027c0133fc8c17bf4314b0e009ed86))
* **tui:** add snapshot test with tuistory ([778ac05](https://github.com/pi-ohm/pi-ohm/commit/778ac051f078822d8a11a098ae337f3125ac7ef9))


### Bug Fixes

* **ci:** avoid bundled typebox in tui ([11ced07](https://github.com/pi-ohm/pi-ohm/commit/11ced0736c618094c1b1887e0a2f83d58538c1f9))
* **core,tui:** better tool truncation ([2dc5447](https://github.com/pi-ohm/pi-ohm/commit/2dc544706b70dfab38aec7f82c9b70b6a5cf5a54))
* **goal,tui:** border colors ([25bc4b3](https://github.com/pi-ohm/pi-ohm/commit/25bc4b31e37a4ae5942916ce84c747cdcbefbe6e))
* **goal,tui:** status line ([ecb1d16](https://github.com/pi-ohm/pi-ohm/commit/ecb1d167aa9cae97579bb728397ab7a4df7a0a3a))
* **root:** add better schema ([ba1fea6](https://github.com/pi-ohm/pi-ohm/commit/ba1fea602f4a2d25375f430d07a333e647aa026c))
* **root:** replace generic record guards ([e538eb8](https://github.com/pi-ohm/pi-ohm/commit/e538eb8b82fb662b15b939ab08ddf316f1d3708e))
* **subagents,tui:** enable compaction of tool calls in tree ([a33f0d5](https://github.com/pi-ohm/pi-ohm/commit/a33f0d5cd9267d8b9728ee42ce5febf30282b8ac))
* **subagents,tui:** fix bolding in tree heading and tool prefixes ([7c4d37a](https://github.com/pi-ohm/pi-ohm/commit/7c4d37a59319495d211065e1855e0b11cae6e9b0))
* **subagents:** fix tui ([746486e](https://github.com/pi-ohm/pi-ohm/commit/746486ec301c5f74d0c344eda0915b9f8387bd32))
* **tui,subagents:** color status markers and switch running header marker to bullet ([27ef5d6](https://github.com/pi-ohm/pi-ohm/commit/27ef5d6b3c033a27bd02ba3666fe73dc4137e630))
* **tui,subagents:** make subagents look better ([b7cfc25](https://github.com/pi-ohm/pi-ohm/commit/b7cfc250c44312672079d2c50147a1fd9e6732ca))
* **tui,subagents:** remove spinners :( ([a92cba7](https://github.com/pi-ohm/pi-ohm/commit/a92cba7955b74a953e027629775fcebfc09f555c))
* **tui,subagents:** stabilize running task tree prompt layout ([ffd8ea1](https://github.com/pi-ohm/pi-ohm/commit/ffd8ea1cfebbd174fd8e5a91783b922ec7fee779))
* **tui:** avoid ohm load-time actions ([8e56f9d](https://github.com/pi-ohm/pi-ohm/commit/8e56f9dd6be80facac3d604fb5aa1ea92df269f4))
* **tui:** declare typebox test dependency ([1d82cbc](https://github.com/pi-ohm/pi-ohm/commit/1d82cbc4b4b5c0f37c95237b2e85c345fc537226))
* **tui:** make ohm config command singular ([ff9e569](https://github.com/pi-ohm/pi-ohm/commit/ff9e569f5e90edb64cd280a2d1ea3d463cf8704d))
* **tui:** render compact tool-call overflow on guide rail + dim ctrl+o hint ([4639a39](https://github.com/pi-ohm/pi-ohm/commit/4639a393db20f1bbc4edcb795eb7da094c97d1da))
* **tui:** resolve tui test harness deps ([dc492cf](https://github.com/pi-ohm/pi-ohm/commit/dc492cfaf23075c5dfd6f849939d8d9fdb5ae15b))
* **tui:** use lighter grey tone for compact ctrl+o hint ([b0d8ff4](https://github.com/pi-ohm/pi-ohm/commit/b0d8ff45f3da5e22d0c405895a996ab7b9dc9260))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pi-ohm/core bumped to 1.0.0

## [0.6.4] - 2026-02-18

- initial package scaffold for reusable Pi OHM tui components.
