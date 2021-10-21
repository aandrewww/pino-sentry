// eslint-disable-next-line @typescript-eslint/no-var-requires
const build = require('pino-abstract-transport');

export default async function () {
  return build(async function (source: any) {
    for await (const obj of source) {
      console.log(obj);
    }
  });
}
