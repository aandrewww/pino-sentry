import { Writable } from 'stream';

export default () => {
  const stream = new Writable({
    write(chunk, _enc, cb) {
      // apply a transform and send to stdout
      console.log(chunk.toString().toUpperCase());
      cb();
    }
  });

  return stream;
};
