import express from 'express';
import { get_state, commit, cond_install_snapshot, snapshot, new_raft, start } from "../raft/lib.js";
import { get_kv_port } from '../util.js';
function get_or_insert_client(kv, client_id) {
    kv.lastProcessedMsgId[client_id] = kv.lastProcessedMsgId[client_id] || -1;
    return kv.lastProcessedMsgId[client_id];
}
function wait(kv, resolve, term, client_id, msg_id) {
    let start = new Date();
    let c = setInterval(() => {
        let { term: newTerm, isLeader } = get_state(kv.raft);
        if ((new Date().getTime() - start.getTime()) > 4000) {
            clearInterval(c);
            resolve(false);
        } // timeout after 4 seconds
        else if (!isLeader || newTerm != term) {
            clearInterval(c);
            resolve(false);
        }
        else if (msg_id <= kv.lastProcessedMsgId[client_id]) {
            clearInterval(c);
            resolve(true);
        }
    }, 20);
}
async function server(kv, args) {
    if (args.msg_id > get_or_insert_client(kv, args.client_id))
        var { index, term, isLeader } = commit(kv.raft, args);
    else
        var { term, isLeader } = get_state(kv.raft);
    if (!isLeader)
        return { status: "WrongLeader" };
    let r = await new Promise(resolve => wait(kv, resolve, term, args.client_id, args.msg_id));
    if (!r)
        return { status: "WrongLeader" };
    else if (args.key in kv.items)
        return { status: "OK", value: kv.items[args.key] };
    else
        return { status: "NoKey" };
}
async function applyCommand(kv, { index, term, item: { msg_id, client_id, key, value, op } }) {
    let current_msg_id = get_or_insert_client(kv, client_id);
    kv.lastAppliedLen++;
    if (msg_id > current_msg_id) {
        if (op == "put")
            kv.items[key] = value;
        if (op == "append")
            kv.items[key] = (kv.items[key] || "") + value;
        kv.lastProcessedMsgId[client_id] = msg_id;
        if (kv.raft.log.items.length > 20) {
            snapshot(kv.raft, index + 1, structuredClone({ items: kv.items, lastProcessedMsgId: kv.lastProcessedMsgId }));
        }
    }
}
async function applySnapshot(kv, { snapshot: { items, lastProcessedMsgId }, snapshotTerm, snapshotLen }) {
    if (cond_install_snapshot(kv.raft, snapshotTerm, snapshotLen, structuredClone({ items, lastProcessedMsgId }))) {
        kv.items = items;
        kv.lastProcessedMsgId = lastProcessedMsgId;
        kv.lastAppliedLen = snapshotLen;
    }
}
async function applier(kv, args) {
    if (args.type == "Snapshot" && args.snapshot != undefined)
        return applySnapshot(kv, args);
    else if (args.type == "Command")
        return applyCommand(kv, args);
}
export async function start_server(peers, me) {
    let kv = {
        items: {},
        lastProcessedMsgId: {},
        lastAppliedLen: 0,
        raft: new_raft(peers, me, (args) => applier(kv, args))
    };
    start(kv.raft);
    express()
        .use(express.json())
        .use((err, req, res, next) => {
        console.log(err.stack);
        res.status(500).send('Something broke!');
    })
        .post('/server', async (req, res) => res.send(await server(kv, req.body)))
        .listen(get_kv_port(me), () => { });
    return kv;
}
