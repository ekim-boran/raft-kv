import axios from "axios"
import { action_append, action_get, action_put, status_no_key, status_ok } from "./util.js";

async function send_RPC(client, rpc, args) {
    try { return (await axios.post(new URL(rpc, client.servers[client.leader]).href, args, { timeout: 500 })).data; }
    catch (e) { return {} }
}

export function make_client(servers) {
    return {
        leader: 0,
        me: Math.floor(Math.random() * 100000),
        servers,
        lastMessageId: 1
    }
}

export async function get(client, key) {
    const args = { client_id: client.me, msg_id: client.lastMessageId++, key: key };
    while (true) {
        for (let i = 0; i < client.servers.length; i++) {
            let reply = await send_RPC(client, action_get, args);
            if (reply.status == status_ok) return reply.value;
            else if (reply.status == status_no_key) return ""
            else client.leader = (client.leader + 1) % client.servers.length;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

export async function PutAppend(client, key, value, op) {
    const args = { client_id: client.me, msg_id: client.lastMessageId++, key: key, value: value, op: op }
    while (true) {
        for (let i = 0; i < client.servers.length; i++) {
            let reply = await send_RPC(client, op, args);
            if (reply.status == status_ok) { return reply.value }
            else client.leader = (client.leader + 1) % client.servers.length;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

export const put = (ck, key, value) => PutAppend(ck, key, value, action_put)
export const append = (ck, key, value) => PutAppend(ck, key, value, action_append)

