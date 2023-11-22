var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
import axios from "axios";
import express from 'express';
import { spawn } from 'node:child_process';
import fs from "node:fs/promises";
import path from "path";
import { writeFileSync } from 'node:fs';
import { make_client, get, put, append } from "../src/raft_kv/client.js";
import { delay, equal, get_debug_port } from "../src/util.js";
class Node {
    constructor(params) {
        this.params = params;
        this.logs = [];
        this.lastApplied = -1;
    }
    start() {
    }
    crash() {
    }
    restart() {
    }
}
export async function send_RPC(config, to, rpc, args) {
    if (!is_connected(config, to))
        return {};
    return axios.post(`http://localhost:${get_debug_port(to)}/${rpc}`, args).then(i => i.data).catch(_ => ({}));
}
export async function proxy(config, req, res) {
    let _a = req.body, { from, to } = _a, rest = __rest(_a, ["from", "to"]);
    if (config.disconnected.has(from) || config.disconnected.has(to)) {
        await delay(200);
        return res.status(404).send(null);
    }
    config.rpc_count += 1;
    if (!config.reliable)
        await delay(Math.floor(Math.random() * 27));
    if (!config.reliable && Math.floor(Math.random() * 1000) < 100) {
        await delay(200);
        return res.status(500).send(null);
    } // drop request
    try {
        const call = await axios.post(`${to}${req.url}`, rest);
        if (!config.reliable)
            await delay(Math.floor(Math.random() * 27));
        if (!config.reliable && Math.floor(Math.random() * 1000) < 100) {
            await delay(200);
            return res.status(500).send(null);
        } // drop reply
        return res.send(call.data);
    }
    catch (e) {
        return res.status(500).send(null);
    }
}
export const clear_data_dir = () => fs.readdir("data").then(files => Promise.all(files.map(file => fs.unlink(path.join("data", file))))).catch(_ => { });
export async function make_generic_test(create, n, unreliable = false, snapshot = false) {
    await clear_data_dir();
    let servers = Array(n).fill(0).map((x, i) => `http://localhost:${(i + 8090)}`);
    let config = { stop: false, servers, create: create, disconnected: new Set(), rpc_count: 0, reliable: !unreliable, snapshot: snapshot, nodes: {},
        server: express().use(express.json()).post('/*', (req, res) => proxy(config, req, res)).listen(9000, () => { }) };
    config.nodes = servers.map(i => [i, ...servers.filter(j => j != i)])
        .reduce((a, p) => {
        let start = () => create(p, config);
        return Object.assign(Object.assign({}, a), { [p[0]]: { server: create(p, config), params: p, logs: [], lastApplied: -1 } });
    }, {});
    await delay(2000);
    return config;
}
export function create_raft(xs, config) {
    const raft = spawn('node', ['./built/test/bin_raft.js', ...xs]);
    raft.stdout.on('data', (data) => process.stdout.write(`--> ${xs[0]}: ${data}`));
    raft.stderr.on('data', (data) => {
        try {
            data.toString().split("\n").filter((i) => i != "").forEach((e) => applier(config, JSON.parse(e)));
        }
        catch (_a) {
            process.stdout.write(`--> ${xs[0]}: ${data}`);
        }
    });
    return raft;
}
async function applier(config, _a) {
    var { from } = _a, msg = __rest(_a, ["from"]);
    if (msg.type == "Snapshot") {
        let reply = await send_RPC(config, from, "CondInstallSnapshot", { len: msg.snapshotLen, term: msg.snapshotTerm, snapshot: msg.snapshot });
        if (reply.ok) {
            config.nodes[from].lastApplied = Math.max(config.nodes[from].lastApplied, msg.snapshotLen - 1);
            config.nodes[from].logs[msg.snapshotLen - 1] = msg.snapshot;
        }
    }
    else if (msg.index > config.nodes[from].lastApplied) {
        if (msg.index > 0 && config.nodes[from].logs[msg.index - 1] == undefined)
            throw "Out of Order";
        if (config.servers.some(s => config.nodes[s].logs[msg.index] !== undefined && !equal(config.nodes[s].logs[msg.index], msg.item)))
            throw "Different entries";
        config.nodes[from].logs[msg.index] = msg.item;
        config.nodes[from].lastApplied = msg.index;
        if (config.snapshot && (msg.index + 1) % 10 == 0)
            await send_RPC(config, from, "Snapshot", { len: msg.index + 1, snapshot: msg.item });
    }
    else if (!equal(config.nodes[from].logs[msg.index], msg.item)) {
        throw "Different entries";
    }
}
export function disconnect(config, node) {
    console.log("disconnected", node);
    config.disconnected.add(node);
}
export function connect(config, node) {
    console.log("connected", node);
    config.disconnected.delete(node);
}
export function restart(config, node) {
    console.log("restart:", node);
    crash(config, node);
    config.nodes[node].server = config.create(config.nodes[node].params, config);
}
export function crash(config, node) {
    console.log("crash:", node);
    config.nodes[node].server.kill('SIGKILL');
}
export async function stop_test(config) {
    for (let node in config.nodes) {
        crash(config, node);
    }
    config.server.close();
    await delay(2000);
}
export async function check_one_leader(config) {
    for (let i = 0; i < 10; i++) {
        await delay(100);
        let responses = {};
        let promises = await Promise.all(config.servers.map(node => send_RPC(config, node, "State", {})));
        for (let p of promises) {
            if (p != null && p.isLeader) {
                responses[p.term] = responses[p.term] || [];
                responses[p.term].push(p.nodeId);
            }
        }
        let lastTerm = 0;
        for (let term in responses) {
            if (responses[term].length > 1) {
                throw "more than one leaders in a term";
            }
            if (Number(term) > lastTerm)
                lastTerm = Number(term);
        }
        if (lastTerm != 0)
            return responses[lastTerm][0];
        await delay(900);
    }
    throw "cannot find new leader";
}
export async function check_no_leader(config) {
    for (let node in config.nodes) {
        let r = await send_RPC(config, node, "State", {});
        if (r != null && r.isLeader) {
            throw "more than one leaders in a term";
        }
    }
}
export function is_connected(config, node) {
    return !config.disconnected.has(node);
}
export function nCommited(config, index) {
    let n = config.servers.length;
    let results = [];
    for (let i = 0; i < n; i++) {
        results.push(config.nodes[config.servers[i]].logs[index]);
    }
    let r = results.filter(i => i != undefined);
    if (r.length != 0 && r.some(i => !equal(i, r[0]))) {
        throw "here";
    }
    return [r.length, r[0]];
}
export async function one(config, cmd, expectedServers, retry) {
    let n = config.servers.length;
    let starts = 0;
    const start = Date.now();
    while (Date.now() - start < 10000) {
        let index = -1;
        for (let si = 0; si < n; si++) {
            starts = (starts + 1) % n;
            if (is_connected(config, config.servers[starts])) {
                let resp = await send_RPC(config, config.servers[starts], "Commit", { item: cmd });
                if (resp.isLeader) {
                    index = resp.index;
                    break;
                }
            }
        }
        if (index != -1) {
            const start = Date.now();
            while (Date.now() - start < 2000) {
                let [nd, cmd] = nCommited(config, index);
                if (nd > 0 && nd >= expectedServers) {
                    return index;
                }
                await delay(100);
            }
            if (retry == false) {
                throw "Cannot reach agreement1";
            }
        }
        else {
            await delay(50);
        }
    }
    throw "Cannot reach agreement2";
}
export async function wait(config, index, n, startTerm) {
    let to = 10;
    for (let iters = 0; iters < 30; iters++) {
        let [nd, _] = nCommited(config, index);
        if (nd >= n)
            break;
        await delay(to);
        if (to < 1000) {
            to = to * 2;
        }
        if (startTerm > -1) {
            let promises = await Promise.all(config.servers.map(node => send_RPC(config, node, "State", {})));
            for (let p of promises) {
                if (p != null && p.term != startTerm) {
                    return -1;
                }
            }
        }
    }
    let [nd, cmd] = nCommited(config, index);
    if (nd < n) {
        throw "Error";
    }
    return cmd;
}
/////////////
export function execute_porcupine(result) {
    writeFileSync("porcupine/test.json", JSON.stringify(result));
    const srv = spawn('go', ['run', 'main'], { cwd: "porcupine" });
    srv.stdout.on('data', (data) => process.stdout.write(`--> ${data}`));
    srv.stderr.on('data', (data) => process.stderr.write(`-->  ${data}`));
    return new Promise(resolve => {
        srv.on('close', async (code) => {
            resolve(code);
        });
    });
}
export async function execute_clients(nclients, servers, nactions, nkeys) {
    const getTime = () => {
        let t = process.hrtime();
        return t[0] * 1000000000 + t[1];
    };
    let c = 0;
    async function execute_actions(client, cid) {
        let results = [];
        for (let i = 0; i < nactions; i++) {
            let op = Math.floor(Math.random() * 3);
            op = op == 1 ? 2 : op;
            let key = (Math.floor(Math.random() * nkeys)).toString();
            let value = "[" + (c++) + "]";
            let start = getTime();
            let result = await ((op == 0) ? get(client, key) : (op == 1) ? put(client, key, value) : append(client, key, value));
            let end = getTime();
            results.push({ op, key, value, output: result, start, end, clientId: cid });
            await delay(30);
        }
        return results;
    }
    let clients = Array(nclients).fill(0).map(_ => make_client(servers));
    let res = await Promise.all(clients.map((c, i) => execute_actions(c, i)));
    return res.flat();
}
