#!/usr/bin/env bun
import { runBridgeCommand } from "./bridge-command.ts";

// Compatibility entry point for source checkouts and pre-consolidation installs.
process.exit(await runBridgeCommand(process.argv.slice(2)));
