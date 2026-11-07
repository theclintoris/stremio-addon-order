#!/usr/bin/env node

import { main } from '../src/cli.js';

// Piping into `head` closes stdout early; that is not an error worth a stack trace.
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code ?? 0;
  })
  .catch((error) => {
    process.stderr.write(`Error: ${error?.message ?? error}\n`);
    process.exitCode = 1;
  });
