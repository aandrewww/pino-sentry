// eslint-disable-next-line @typescript-eslint/no-var-requires
const build = require('pino-abstract-transport');

export default async function (opts) {
  return build(async function (source) {
    for await (let obj of source) {
      console.log(obj);
    }
  });
}
