# gyeonggi

A source for Bridgething apps.

## Develop

```sh
bun run dev            # develop the app against a connected bridgething instance
bun run dev:device     # show the dev server on the car thing screen
bun run push           # build and install to the device
bun run check          # ensure the catalog is valid
```

With more than one app in `apps/` your commands must specify which one: `bun run dev gyeonggi`.

Screenshot for the store listing:

```sh
bun run shot gyeonggi            # grabs what is on the screen
bun run shot gyeonggi --replace  # overwrite
```

## Add another app

```sh
bun run new weather                 # a webapp
bun run new dashboard --extension   # a webapp plus a desktop-side Deno process
bun run new home --launcher         # a replacement home screen
bun run new hud --overlay           # a system overlay drawn over every webapp
```

## Ship

```sh
bun run bump gyeonggi patch -m "Fix the wind direction arrow"
git commit -am "gyeonggi: fix the wind direction arrow" && git push
```

Pushing to main builds the apps and regenerates the catalog.

## Agent skill

`.claude/skills/bridgething/` holds the `/bridgething` skill.

```sh
bun run skills           # refresh it from the published create-bridgething
bun run skills --check   # check whether it is behind
```
