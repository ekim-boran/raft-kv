export const get_port = (host: string) => parseInt(new URL(host).port)
export const get_debug_port = (host: string) => get_port(host) + 1000;
export const get_kv_port = (host: string) => get_port(host) + 2000

export const equal = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b)
export const delay = (n: number) => new Promise(resolve => setTimeout(resolve, n))
