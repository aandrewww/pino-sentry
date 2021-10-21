import { Writable } from 'stream';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default (options: any) => {
  const stream = new Writable({
    write(chunk, enc, cb) {
      // apply a transform and send to stdout
      console.log(chunk.toString().toUpperCase());
      cb();
    }
  });

  return stream;
};
