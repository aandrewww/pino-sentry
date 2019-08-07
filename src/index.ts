#!/usr/bin/env node

import program from 'commander';

// import pkg from '../package.json';
import { createWriteStream } from './transport';

// main cli logic
function main () {
  program
    // .version(pkg.version)
    .option('-d, --dsn <dsn>', 'Your Sentry DSN or Data Source Name')
    .option('-e, --environment <environment>', 'Sentry environment')
    .option('-n, --serverName <serverName>', 'Transport name')
    .option('-dm, --debug <debug>', 'Turns debug mode on or off')
    .option('-sr, --sampleRate <sampleRate>', 'Sample rate as a percentage of events to be sent in the range of 0.0 to 1.0')
    .option('-mb, --maxBreadcrumbs <maxBreadcrumbs>', 'Total amount of breadcrumbs that should be captured')
    .action(async ({ dsn, serverName, environment, debug, sampleRate, maxBreadcrumbs }) => {
      try {
        const writeStream = await createWriteStream({
          dsn,
          serverName,
          environment,
          debug,
          sampleRate,
          maxBreadcrumbs,
        });
        process.stdin.pipe(writeStream);
        console.info('logging');
      } catch (error) {
        console.log(error.message);
      }
    });

  program.parse(process.argv);
}

main();
