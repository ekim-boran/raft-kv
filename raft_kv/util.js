
export const status_ok = "OK"
export const status_no_key = "NoKey"
export const status_wrong_leader = "WrongLeader"

export const action_get = "get"
export const action_put = "put"
export const action_append = "append"
export const get_kv_port = (x) => parseInt(new URL(x).port) + 2000
