## CLI usage

**REQUIREMENT:** You MUST run `tuistory --help` before using the CLI. The CLI evolves and the help output is the source of truth for available commands, options, and syntax. Always check it first.

Install globally or use npx/bunx:

```bash
# global
bun add -g tuistory
npm install -g tuistory

# or without installing
npx tuistory --help
bunx tuistory --help
```

### CLI quick reference

```bash
tuistory launch <command> -s <name> [--cols N] [--rows N] [--env KEY=VAL]
tuistory -s <name> snapshot --trim
tuistory -s <name> screenshot -o image.jpg --pixel-ratio 2
tuistory -s <name> type "text"
tuistory -s <name> press enter
tuistory -s <name> press ctrl c
tuistory -s <name> click "Submit"
tuistory -s <name> wait "pattern" --timeout 10000
tuistory -s <name> wait "/regex/" --timeout 10000
tuistory -s <name> scroll down 5
tuistory -s <name> resize 120 40
tuistory -s <name> close
tuistory sessions
tuistory daemon-stop
```

Always run `snapshot --trim` after every action to see the current terminal state.

### Screenshot for agent bots

Capture terminal as an image to upload to users (Discord, Slack, web UIs).
Use `--pixel-ratio 2` for sharp images on social media and messaging apps:

```bash
tuistory -s myapp screenshot -o /tmp/terminal.jpg --pixel-ratio 2
# then upload /tmp/terminal.jpg to the user
```
