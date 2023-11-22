import axios from "axios";
import { delay } from "../util.js";
const send_RPC = (client, args) => axios.post(new URL("server", client.servers[client.leader]).href, args, { timeout: 500 }).then(i => i.data).
    catch(_ => ({ status: "WrongLeader" }));
export function make_client(servers) {
    return {
        leader: 0,
        me: Math.floor(Math.random() * 100000),
        servers,
        lastMessageId: 1
    };
}
async function call(client, key, value, op) {
    const args = { client_id: client.me, msg_id: client.lastMessageId++, key: key, value: value, op: op };
    while (true) {
        for (let i = 0; i < client.servers.length; i++) {
            let reply = await send_RPC(client, args);
            if (reply.status == "OK")
                return reply.value;
            else if (reply.status == "NoKey")
                return "";
            else
                client.leader = (client.leader + 1) % client.servers.length;
        }
        await delay(100);
    }
}
export const get = (ck, key) => call(ck, key, "", "get");
export const put = (ck, key, value) => call(ck, key, value, "put");
export const append = (ck, key, value) => call(ck, key, value, "append");
