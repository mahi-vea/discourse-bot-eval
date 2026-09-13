// Stub for discourse/lib/ajax.
export const calls = [];

let handler = (url) => Promise.resolve(url === "/posts" ? { id: 900 } : {});

export function setHandler(fn) {
  handler = fn;
}

export function reset() {
  calls.length = 0;
  handler = (url) => Promise.resolve(url === "/posts" ? { id: 900 } : {});
}

export function ajax(url, opts = {}) {
  calls.push({ url, type: opts.type, data: opts.data });
  return handler(url, opts);
}
