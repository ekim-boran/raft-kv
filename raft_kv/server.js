import { Raft, get_state, commit, cond_install_snapshot, snapshot } from "../raft/lib.js"
import express from 'express'
import { status_wrong_leader, status_no_key, status_ok, action_get, action_put, action_append, get_kv_port } from "./util.js";


function get_or_insert_client(kv, client_id) {
    kv.lastProcessedMsgId[client_id] = kv.lastProcessedMsgId[client_id] || -1;
    return kv.lastProcessedMsgId[client_id];
}

function wait(kv, resolve, term, client_id, msg) {
    let start = new Date()
    let c = setInterval(() => {
        let { term: newTerm, isLeader } = get_state(kv.raft);
        if (new Date() - start > 4000) { clearInterval(c); resolve(false) } // timeout after 4 seconds
        else if (!isLeader || newTerm != term) { clearInterval(c); resolve(false) }
        else if (msg <= kv.lastProcessedMsgId[client_id]) { clearInterval(c); resolve(true) }
    }, 20);
}

async function shared(kv, args) {
    if (args.msg_id > get_or_insert_client(kv, args.client_id)) var { index, term, isLeader } = commit(kv.raft, args);
    else var { term, isLeader } = get_state(kv.raft);
    if (!isLeader) return { status: status_wrong_leader }
    let r = await new Promise(resolve => wait(kv, resolve, term, args.client_id, args.msg_id));
    if (!r) return { status: status_wrong_leader }
    else if (args.key in kv.items) return { status: status_ok, value: kv.items[args.key] }
    else return { status: status_no_key, value: kv.items[args.key] }
}

const get = (kv, args) => shared(kv, { op: action_get, ...args });
const put = shared
const append = shared

async function applyCommand(kv, { index, term, item: { msg_id, client_id, key, value, op } }) {
    let current_msg_id = get_or_insert_client(kv, client_id);
    kv.lastAppliedLen++;

    if (msg_id > current_msg_id) {
        if (op == action_put) kv.items[key] = value;
        if (op == action_append) kv.items[key] = (kv.items[key] || "") + value;
        kv.lastProcessedMsgId[client_id] = msg_id
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
    let { type, ...data } = args;
    if (type == "Snapshot" && data.snapshot != undefined) return applySnapshot(kv, data);
    else if (type == "Command") return applyCommand(kv, data)
}

export async function start_server(peers, me) {
    let kv = {
        items: {},
        lastProcessedMsgId: {},
        lastAppliedLen: 0,
    }
    kv.raft = new Raft(peers, me, (args) => applier(kv, args));
    kv.raft.start();

    const app = express();
    app.use(express.json());

    app.use((err, req, res, next) => {
        console.log(err.stack);
        res.status(500).send('Something broke!')
    });

    app.post('/get', async (req, res) => res.send(await get(kv, req.body)))
        .post('/put', async (req, res) => res.send(await put(kv, req.body)))
        .post('/append', async (req, res) => res.send(await append(kv, req.body)))
        .listen(get_kv_port(me), () => { console.log("listening") })

    return kv;
}