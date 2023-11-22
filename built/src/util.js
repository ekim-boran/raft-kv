export const get_port = (host) => parseInt(new URL(host).port);
export const get_debug_port = (host) => get_port(host) + 1000;
export const get_kv_port = (host) => get_port(host) + 2000;
export const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const delay = (n) => new Promise(resolve => setTimeout(resolve, n));
