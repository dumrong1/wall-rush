# Wall Rush - deployment copy

This folder is the repository root. Upload its CONTENTS to a private GitHub repository, including .node-version and .gitignore.

## Render
Create a Node Web Service connected to that repository, or use render.yaml as a Blueprint.
- Root directory: blank (repository root)
- Build: corepack enable && pnpm install --frozen-lockfile --prod
- Start: node serve.cjs
- Environment: NODE_ENV=production
- Health check: /healthz
- Instances: 1 (rooms are in memory)
- Select Free for initial testing. Check Render's current plan limits before deploying.

No credentials or environment secrets are required by the game. Render provides PORT and HTTPS; the browser uses same-origin WSS. Do not configure localhost as a public backend.

## Local
Use the Node version in .node-version, then run:
```
corepack enable
pnpm install --frozen-lockfile
pnpm start
```
Open http://127.0.0.1:8018/ . Test with `pnpm test`.

## Included
Current opening artwork, room menu, practice/spectator, Wetlands V3, authoritative multiplayer, approved GLBs, bundled Three.js and its license, and nine multiplayer/deployment test suites.

Runtime game files are copied unchanged. package.json test scripts are limited to the included suites; historical art/simulation experiments are excluded.

## Excluded
node_modules, Blender source, checkpoints, logs, reports, development experiments, private/configuration files and credentials.

This is a prepared source package, not an already-published website. Dependency installation is required. Server restarts/redeploys clear rooms; create a new room afterward. No multi-instance scaling without shared room state.
