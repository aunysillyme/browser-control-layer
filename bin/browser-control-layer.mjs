#!/usr/bin/env node
import { main, commandError } from '../src/cli.mjs';
try { process.exitCode = await main(process.argv.slice(2)); }
catch (error) { console.error(commandError(error)); process.exitCode = error.exitCode || 1; }
