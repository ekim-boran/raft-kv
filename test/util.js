import axios from "axios"
import express from 'express'
import { spawn } from 'node:child_process'
import fs from "node:fs/promises"
import path from "path"
import { writeFileSync } from 'node:fs'
import { make_client, get, put, append } from "../raft_kv/client.js"

export const get_port = (x) => parseInt(new URL(x).port)
export const get_debug_port = (x) => get_port(x) + 1000;

export const permutations = arr => {
    let res = []
    for (let i = 0; i < arr.length; i++) {
        res.push([arr[i], ...arr.filter(j => j != arr[i])])
    }
    return res;
}

export const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
export const delay = (n) => new Promise(resolve => setTimeout(resolve, n))
export const clear_data_dir = () => fs.readdir("data").then(files => Promise.all(files.map(file => fs.unlink(path.join("data", file)))))

export async function proxy(config, req, res) {
    let { from, to, ...rest } = req.body;
    if (config.disconnected.has(from) || config.disconnected.has(to)) { await delay(200); return res.status(404).send(null); }
    config.rpc_count += 1;
    if (!config.reliable) await delay(Math.floor(Math.random() * 27));
    if (!config.reliable && Math.floor(Math.random() * 1000) < 100) { await delay(200); return res.status(500).send(null); } // drop request
    try {
        const call = await axios.post(`${to}${req.url}`, rest);
        if (!config.reliable) await delay(Math.floor(Math.random() * 27));
        if (!config.reliable && Math.floor(Math.random() * 1000) < 100) { await delay(200); return res.status(500).send(null); } // drop reply
        return res.send(call.data);
    }
    catch (e) {
        return res.status(500).send(null);
    }
}



export async function send_RPC(config, to, rpc, args) {
    if (!is_connected(config, to)) return {};
    try {
        const call = await axios.post(`http://localhost:${get_debug_port(to)}/${rpc}`, args);
        return call.data
    }
    catch { return {} }
}


export async function make_generic_test(create, n, unreliable = false, snapshot = false) {
    await clear_data_dir()
    let servers = Array(n).fill().map((x, i) => "http://localhost:" + (i + 8090));
    let config = { stop: false, servers, create: create, nodes: {}, disconnected: new Set(), rpc_count: 0, reliable: !unreliable, snapshot: snapshot }
    let ps = permutations(servers);
    for (let p of ps) config.nodes[p[0]] = { server: create(p, config), params: p, logs: [], lastApplied: -1 };
    config.server = express().use(express.json()).post('/*', (req, res) => proxy(config, req, res)).listen(9000, () => { });
    await delay(2000);
    return config;
}


export function create_raft(xs, config) {
    const raft = spawn('node', ['./test/bin_raft.js', ...xs]);
    raft.stdout.on('data', (data) => process.stdout.write(`--> ${xs[0]}: ${data}`));
    raft.stderr.on('data', (data) => {
        try { data.toString().split("\n").filter(i => i != "").forEach(e => applier(config, JSON.parse(e))); }
        catch { }
    });
    return raft;
}

async function applier(config, body) {
    let { type, from, index, snapshotTerm, snapshotLen, snapshot, ...item } = body;
    if (type == "Snapshot") {
        let reply = await send_RPC(config, from, "CondInstallSnapshot", { len: snapshotLen, term: snapshotTerm, snapshot: snapshot });
        if (reply.ok) {
            config.nodes[from].lastApplied = Math.max(config.nodes[from].lastApplied, snapshotLen - 1)
            config.nodes[from].logs[snapshotLen - 1] = snapshot;
        }
    }
    else if (index > config.nodes[from].lastApplied) {
        if (index > 0 && config.nodes[from].logs[index - 1] == undefined)
            throw "Out of Order"
        if (config.servers.some(s => config.nodes[s].logs[index] !== undefined && !equal(config.nodes[s].logs[index], item)))
            throw "Different entries"
        config.nodes[from].logs[index] = item;
        config.nodes[from].lastApplied = index;
        if (config.snapshot && (index + 1) % 10 == 0)
            await send_RPC(config, from, "Snapshot", { len: index + 1, snapshot: item });
    } else if (!equal(config.nodes[from].logs[index], item)) {
        throw "Different entries"
    }
}


export function restart(config, node) {
    console.log("restart:", node)
    config.nodes[node].server.kill();
    config.nodes[node].server = config.create(config.nodes[node].params, config);
}

export function crash(config, node) {
    console.log("crash:", node)
    config.nodes[node].server.kill();
}

export async function stop_test(config) {
    for (let node in config.nodes) {
        config.nodes[node].server.kill()
    }
    config.server.close();
}

export async function check_one_leader(config) {
    for (let i = 0; i < 10; i++) {
        await delay(100);

        let responses = {}
        let promises = await Promise.all(config.servers.map(node => send_RPC(config, node, "State")));
        for (let p of promises) {
            if (p != null && p.isLeader) {
                responses[p.term] = responses[p.term] || []
                responses[p.term].push(p.nodeId)
            }
        }
        let lastTerm = 0;
        for (let term in responses) {
            if (responses[term].length > 1) {
                throw "more than one leaders in a term";
            }
            if (term > lastTerm) lastTerm = term;
        }
        if (lastTerm != 0) return responses[lastTerm][0];
        await delay(900);

    }
    throw "cannot find new leader";

}

export async function check_no_leader(config) {
    for (let node in config.nodes) {
        let r = await send_RPC(config, node, "State");
        if (r != null && r.isLeader) {
            throw "more than one leaders in a term";
        }
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

export function is_connected(config, node) {
    return !config.disconnected.has(node);
}

export function nCommited(config, index) {
    let n = config.servers.length;
    let results = []
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
        let index = -1
        for (let si = 0; si < n; si++) {
            starts = (starts + 1) % n
            if (is_connected(config, starts)) {
                let resp = await send_RPC(config, config.servers[starts], "Commit", { item: cmd });
                if (resp.isLeader) {
                    index = resp.index
                    break
                }
            }
        }
        if (index != -1) {
            const start = Date.now();
            while (Date.now() - start < 2000) {
                let [nd, cmd] = nCommited(config, index);
                if (nd > 0 && nd >= expectedServers) {
                    return index
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
    throw "Cannot reach agreement2"
}

export async function wait(config, index, n, startTerm) {
    let to = 10;
    for (let iters = 0; iters < 30; iters++) {
        let [nd, _] = nCommited(config, index);
        if (nd >= n) break;
        await delay(to)
        if (to < 1000) {
            to = to * 2;
        }
        if (startTerm > -1) {
            let promises = await Promise.all(config.servers.map(node => send_RPC(config, node, "State")));
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
    return cmd
}


/////////////

export function execute_porcupine(result) {
    writeFileSync("porcupine/test.json", JSON.stringify(result))

    const srv = spawn('go', ['run', 'main'], { cwd: "porcupine" });
    srv.stdout.on('data', (data) => process.stdout.write(`--> ${data}`));
    srv.stderr.on('data', (data) => process.stderr.write(`-->  ${data}`));
    return new Promise(resolve => {
        srv.on('close', async (code) => {
            resolve(code)
        });
    });
}


export async function execute_clients(nclients, servers, nactions, nkeys) {
    const getTime = () => {
        let t = process.hrtime()
        return t[0] * 1000000000 + t[1]
    }
    let c = 0
    async function execute_actions(client, cid, nactions, nkeys) {
        let results = []
        for (let i = 0; i < nactions; i++) {
            let op = Math.floor(Math.random() * 3)
            op = op == 1 ? 2 : op;
            let key = (Math.floor(Math.random() * nkeys)).toString()
            let value = "[" + (c++) + "]"
            let start = getTime()
            let result = await ((op == 0) ? get(client, key) : (op == 1) ? put(client, key, value) : append(client, key, value))
            let end = getTime()
            results.push({ op, key, value, output: result, start, end, clientId: cid })
            await delay(30)
        }
        return results
    }
    let clients = Array(nclients).fill().map(_ => make_client(servers));
    let res = await Promise.all(clients.map((c, i) => execute_actions(c, i, nactions, nkeys)))
    return res.flat()
}