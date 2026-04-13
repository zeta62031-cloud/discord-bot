# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/scripts run discord-bot` — run the Discord bot

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Discord Bot

- Bot code lives in `scripts/src/discord-bot.ts`.
- Requires a private secret named `TOKEN` or `DISCORD_BOT_TOKEN`.
- Optional secret/env var: `DISCORD_BOT_PREFIX` defaults to `,`.
- Commands include `,help`, `,ping`, `,say`, `,avatar`, `,userinfo`, `,serverinfo`, `,botinfo`, `,membercount`, `,uptime`, `,support`, `,invite`, `,coinflip`, `,roll`, `,choose`, and `,clear`.
- Welcome messages require Discord's Server Members Intent to be enabled.
- Welcome settings are configured per server through Discord commands: `,setwelcome`, `,welcome view`, `,welcome channel`, `,welcome message`, `,welcome test`, `,welcome on`, and `,welcome off`.
- Welcome config is stored at runtime in `scripts/data/guild-config.json`.
