
import { Raft, get_state, commit, cond_install_snapshot, snapshot } from "../raft/lib.js"
import express from 'express'
import axios from "axios"
import { get_debug_port } from "./util.js";

const [me, ...peers] = process.argv.slice(2)

function go(requestConfig) {
    return { ...requestConfig, url: new URL(new URL(requestConfig.url).pathname, "http://localhost:9000").href, data: { ...requestConfig.data, from: me, to: "http://" + new URL(requestConfig.url).host } };
}

axios.interceptors.request.use(go);


let raft = new Raft(peers, me, (args) => console.error(JSON.stringify({ from: raft.me, ...args })));

const app = express();
app.use(express.json());

app.post('/State', async (req, res) => res.send(get_state(raft)))
    .post('/Commit', async (req, res) => res.send(commit(raft, req.body.item)))
    .post('/Snapshot', async (req, res) => res.send(snapshot(raft, req.body.len, req.body.snapshot)))
    .post('/CondInstallSnapshot', async (req, res) => res.send({ ok: cond_install_snapshot(raft, req.body.term, req.body.len, req.body.snapshot) }))
    .listen(get_debug_port(me), () => { })

raft.start();



