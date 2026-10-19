#!/usr/bin/env node
import { main } from '../src/cli.mjs';
try { process.exitCode = await main(process.argv.slice(2)); }
catch (error) { console.error(`${error.code || 'COMMAND_FAILED'}: ${error.message}`); process.exitCode = error.exitCode || 1; }
