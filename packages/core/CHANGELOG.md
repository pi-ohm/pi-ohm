# Changelog

## [1.0.0](https://github.com/pi-ohm/pi-ohm/compare/core-v0.6.4...core-v1.0.0) (2026-06-22)


### ⚠ BREAKING CHANGES

* **root:** update better-result, migrate to stricter Err<T, E> by emitting Result.error(result.error) where the success type changes
* **root,core:** move config to core package
* **root:** migrate to vite plus

### refac

* **root,core:** move config to core package ([a67ab17](https://github.com/pi-ohm/pi-ohm/commit/a67ab17a2278a359999dfb9d4724388618d42823))


### Features

* **config:** add pub/sub for config hot reload ([8ae7f48](https://github.com/pi-ohm/pi-ohm/commit/8ae7f48f007eaf0f9b55cdec4bbc5f45fe1fcdfd))
* **core,subagents:** error types with better-result ([d93dedf](https://github.com/pi-ohm/pi-ohm/commit/d93dedfa6634201ebb0c487e85c9bb2f090d7241))
* **core:** add config registry ([d4111d4](https://github.com/pi-ohm/pi-ohm/commit/d4111d49c40e26ac27635ef5817cbec4d37b0d28))
* **core:** add experimental PiP prompt helpers ([5ee1e96](https://github.com/pi-ohm/pi-ohm/commit/5ee1e96bb7eb1609fd7a7f7e358fbb6e278e9fb4))
* **core:** Pi-in-Pi (PiP) ([ab8dffd](https://github.com/pi-ohm/pi-ohm/commit/ab8dffd0b262952d9ea42e68c3825031fef03993))
* **db:** migrate to drizzle/constructor ([d8b3757](https://github.com/pi-ohm/pi-ohm/commit/d8b3757477cc6993034e31121601b3e709103832))
* **references:** update stuff? ([4ed91a2](https://github.com/pi-ohm/pi-ohm/commit/4ed91a2b310d261291eb1dcb8aa2227fc32d26cb))
* **repo,core,config,modes,handoff,subagents,session-search,painter,tui,pi-ohm:** migrate publish pipeline to tsdown dist artifacts ([0e8e307](https://github.com/pi-ohm/pi-ohm/commit/0e8e307ed19938965d1e5bd535eb8eccf7aa9b98))
* **root:** migrate to pnpm ([8674d73](https://github.com/pi-ohm/pi-ohm/commit/8674d73786da3674ea86ad3a5ac3ec13aa1f2451))
* **root:** migrate to vite plus ([126299d](https://github.com/pi-ohm/pi-ohm/commit/126299d94d04bb833a253c0316260b4a0fbfe5f1))
* **subagents:** back agents with pip sessions ([7a9abf4](https://github.com/pi-ohm/pi-ohm/commit/7a9abf41f6f280f573cee2e33e6988762a1061e8))
* **subagents:** extract fork bootstrap forker ([075358c](https://github.com/pi-ohm/pi-ohm/commit/075358caa00d6c028782dacc1ff40c21274df81c))
* **subagents:** own config module ([758d052](https://github.com/pi-ohm/pi-ohm/commit/758d05208d6b6e01b49b7edd99077b4767e121ae))
* **tui:** add ohm config panel ([a073403](https://github.com/pi-ohm/pi-ohm/commit/a073403a94027c0133fc8c17bf4314b0e009ed86))


### Bug Fixes

* **core,db,subagents:** centralize XDG data-home resolution under pi-ohm ([15884cf](https://github.com/pi-ohm/pi-ohm/commit/15884cfb52126a7479bce832c36549412aae4375))
* **core,tui:** better tool truncation ([2dc5447](https://github.com/pi-ohm/pi-ohm/commit/2dc544706b70dfab38aec7f82c9b70b6a5cf5a54))
* **core:** initialize compact fork extensions ([3385f1c](https://github.com/pi-ohm/pi-ohm/commit/3385f1c7aaede1aebf37c87a2c9f39cf621d793a))
* **core:** keep compact fork tool context ([3dcf014](https://github.com/pi-ohm/pi-ohm/commit/3dcf0143c7a279ffb25cede8810822e12fe6be62))
* **core:** preserve falsy snapshots in toolkit lookup resolver ([d51a598](https://github.com/pi-ohm/pi-ohm/commit/d51a59893b6f9f23dab83284075787134c757e5b))
* **db:** imports ([390a325](https://github.com/pi-ohm/pi-ohm/commit/390a3255a2acd1957c89603bdf1cd8775ada9746))
* **root:** add better schema ([ba1fea6](https://github.com/pi-ohm/pi-ohm/commit/ba1fea602f4a2d25375f430d07a333e647aa026c))
* **root:** replace generic record guards ([e538eb8](https://github.com/pi-ohm/pi-ohm/commit/e538eb8b82fb662b15b939ab08ddf316f1d3708e))
* **subagents:** run agents in background ([afa1e71](https://github.com/pi-ohm/pi-ohm/commit/afa1e712b88dff098f072fa4d53448a2a495877c))


### Miscellaneous Chores

* **root:** update better-result, migrate to stricter Err&lt;T, E&gt; by emitting Result.error(result.error) where the success type changes ([d472172](https://github.com/pi-ohm/pi-ohm/commit/d4721724e37dc4070cc8f34f4e10090d0f81b1b5))
