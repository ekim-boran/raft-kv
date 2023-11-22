
import { delay } from '../src/util.js';
import { make_generic_test, create_raft, wait, one, nCommited, connect, disconnect, check_no_leader, check_one_leader, stop_test, send_RPC, restart, crash, Config } from './util.js'


async function Test(f: (con: Config) => Promise<void>, n: number, unreliable = false, snapshot = false) {
    console.log("Starting Test", f.name);
    let config = await make_generic_test(create_raft, n, unreliable, snapshot);
    try {
        await f(config);
    }
    finally {
        await stop_test(config);
    }
    console.log("Completed Test", f.name);
}

const start = (config: Config, leader: string, value: any) => send_RPC(config, leader, "Commit", { item: value })

async function TestInitialElection2A(config: Config) {
    await check_one_leader(config);
    await delay(2000);
    await check_one_leader(config);
}

function get(config: Config, cur: string, i: number) {
    return config.servers[(config.servers.findIndex((a) => a == cur) + i) % (config.servers.length)]
}

async function TestReElection2A(config: Config) {
    let leader = await check_one_leader(config);
    disconnect(config, leader);
    let leader2 = await check_one_leader(config);
    connect(config, leader);
    await check_one_leader(config);
    disconnect(config, leader2);
    disconnect(config, get(config, leader2, 1));
    await check_no_leader(config);
    connect(config, get(config, leader2, 1));
    await check_one_leader(config);
}

async function TestManyElections2A(config: Config) {
    await check_one_leader(config);
    for (let i = 0; i < 10; i++) {
        let i1 = Math.floor(Math.random() * 7);
        let i2 = Math.floor(Math.random() * 7)
        let i3 = Math.floor(Math.random() * 7)
        disconnect(config, config.servers[i1]);
        disconnect(config, config.servers[i2]);
        disconnect(config, config.servers[i3]);
        await check_one_leader(config);
        connect(config, config.servers[i1]);
        connect(config, config.servers[i2]);
        connect(config, config.servers[i3]);
    }
    await check_one_leader(config);
}

async function TestBasicAgree2B(config: Config) {
    let n = config.servers.length;
    for (let i = 0; i < 10; i++) {
        let [nd, _] = nCommited(config, i);
        if (nd > 0) throw "some have committed before Start()"
        let xindex = await one(config, i * 100, n, false);
        if (xindex != i) throw `got index ${xindex} but expected ${i}"`
    }
}

async function TestFailAgree2B(config: Config) {
    let n = config.servers.length;
    await one(config, 101, n, false);
    let leader = await check_one_leader(config);
    disconnect(config, get(config, leader, 1));
    await one(config, 101, n - 1, false);
    await one(config, 102, n - 1, false);
    await one(config, 103, n - 1, false);
    delay(1000);
    await one(config, 104, n - 1, false);
    await one(config, 105, n - 1, false);
    console.log("here")
    connect(config, get(config, leader, 1));
    await one(config, 106, n, true);
    delay(1000);
    await one(config, 107, n, true);
}

async function TestFailNoAgree2B(config: Config) {
    let n = config.servers.length;
    await one(config, 101, n, false);
    let leader = await check_one_leader(config);
    disconnect(config, get(config, leader, 1));
    disconnect(config, get(config, leader, 2));
    disconnect(config, get(config, leader, 3));
    let { index, term, isLeader } = await start(config, leader, 102)
    if (!isLeader) throw "leader rejected Commit";
    if (index != 1) throw "wrong index";
    delay(2000);
    let [nc, _] = nCommited(config, index);
    if (nc > 0) throw "not possible";
    connect(config, get(config, leader, 1));
    connect(config, get(config, leader, 2));
    connect(config, get(config, leader, 3));
    await delay(1000);
    let leader2 = await check_one_leader(config);
    let { index: index2, term: term2, isLeader: isLeader2 } = await start(config, leader, 103);
    if (!isLeader2) throw "leader2 rejected Commit";
    if (index2 < 1 || index > 2) throw "wrong index";
    await one(config, 1000, n, false);
}

async function TestRejoin2B(config: Config) {
    let n = config.servers.length;
    await one(config, 101, n, true);
    let leader = await check_one_leader(config);
    disconnect(config, leader);
    await start(config, leader, 102);
    await start(config, leader, 103);
    await start(config, leader, 104);
    await one(config, 105, n - 1, true);
    let leader2 = await check_one_leader(config);
    disconnect(config, leader2);
    connect(config, leader);
    await one(config, 106, n - 1, true);
    connect(config, leader2);
    await one(config, 107, n, true);
}

async function TestBackup2B(config: Config) {
    let n = config.servers.length;
    await one(config, -1, n, true);
    let leader = await check_one_leader(config);
    disconnect(config, get(config, leader, 2));
    disconnect(config, get(config, leader, 3));
    disconnect(config, get(config, leader, 4));
    for (let i = 0; i < 50; i++) await start(config, leader, i + 50)
    await delay(500);
    disconnect(config, get(config, leader, 0));
    disconnect(config, get(config, leader, 1));
    connect(config, get(config, leader, 2));
    connect(config, get(config, leader, 3));
    connect(config, get(config, leader, 4));

    for (let i = 0; i < 50; i++) await one(config, i, 3, true);
    let leader2 = await check_one_leader(config);
    let other = get(config, leader, 2)
    if (leader2 == other) other = get(config, leader2, 1)
    disconnect(config, other);
    for (let i = 0; i < 50; i++) await start(config, leader2, i + 50)
    await delay(500);
    for (let i = 0; i < n; i++) disconnect(config, config.servers[i]);
    connect(config, get(config, leader, 0));
    connect(config, get(config, leader, 1));
    connect(config, (other));
    for (let i = 0; i < 50; i++) await one(config, 50 + i, 3, true);
    for (let i = 0; i < n; i++) connect(config, config.servers[i]);
    await one(config, -1, n, true);
    await delay(3000)
}

async function TestCount2B(config: Config) {
    let n = config.servers.length;
    let leader = await check_one_leader(config);
    let total1 = config.rpc_count;

    if (total1 > 60 || total1 < 1) {
        console.log(total1)
    }
    loop:
    for (let i = 0; i < 5; i++) {
        if (i > 0) {
            await delay(3000)
        }
        let leader = await check_one_leader(config);
        let total1 = config.rpc_count;
        let { index, term, isLeader } = await send_RPC(config, leader, "Commit", { item: 102 });
        if (!isLeader) {
            continue
        }

        let cmds = []
        let iters = 10;
        for (let i = 1; i < iters + 2; i++) {
            cmds.push(i);
            let { index: index2, term: term2, isLeader: isLeader2 } = await send_RPC(config, leader, "Commit", { item: i });
            if (term != term2) {
                console.log(term, term2, isLeader2)
                continue loop;
            }
            if (!isLeader2) {
                continue loop;
            }
            if (index2 != index + i) {
                throw "Error"
            }
        }
        for (let i = 1; i < iters + 2; i++) {
            let cmd = await wait(config, index + i, n, term);
            if (cmd == -1) {
                continue loop;
            }
            if (cmd["item"] != cmds[i - 1]) {
                console.log(cmd, cmds[i - 1])
            }
        }
        let total2 = config.rpc_count;
        console.log(total1, total2);
        if (total2 - total1 > (iters + 1 + 3) * 3) {
            throw "Error"
        }
    }
    let total2 = config.rpc_count;
    await delay(1000);
    if (config.rpc_count - total2 > 60)
        throw "Error"

}

async function TestPersist12C(config: Config) {
    let servers = config.servers.length;
    await one(config, 11, servers, true);
    for (let i = 0; i < servers; i++) {
        restart(config, config.servers[i]);
    }
    for (let i = 0; i < servers; i++) {
        disconnect(config, config.servers[i]);
        connect(config, config.servers[i])
    }
    await one(config, 12, servers, true);
    let leader = await check_one_leader(config);
    restart(config, leader);
    await one(config, 13, servers, true);
    let leader2 = await check_one_leader(config);
    disconnect(config, leader2);
    await one(config, 14, servers - 1, true);
    restart(config, leader2);
    connect(config, leader2);

    await wait(config, 3, servers, -1);
    let leader3 = await check_one_leader(config);
    let i3 = get(config, leader3, 1)
    disconnect(config, i3)
    await one(config, 15, servers - 1, true);
    restart(config, i3);
    connect(config, i3);
    await one(config, 16, servers, true);
}

async function TestPersist22C(config: Config) {
    let n = config.servers.length;

    let index = 0;
    for (let iters = 0; iters < 5; iters++) {
        await one(config, 10 + index, n, true);
        index++;
        let leader = await check_one_leader(config);
        disconnect(config, get(config, leader, 1))
        disconnect(config, get(config, leader, 2))
        await one(config, 10 + index, n - 2, true);
        index++;
        disconnect(config, get(config, leader, 0))
        disconnect(config, get(config, leader, 3))
        disconnect(config, get(config, leader, 4))
        restart(config, get(config, leader, 1))
        restart(config, get(config, leader, 2))
        connect(config, get(config, leader, 1))
        connect(config, get(config, leader, 2))
        await delay(1000)
        restart(config, get(config, leader, 3))
        connect(config, get(config, leader, 3))
        await one(config, 10 + index, n - 2, true);
        index++;
        connect(config, leader)
        connect(config, get(config, leader, 4))
    }
    await one(config, 1000, n, true);
}

async function TestPersist32C(config: Config) {
    let n = config.servers.length;
    await one(config, 100, n, true);
    let leader = await check_one_leader(config);
    disconnect(config, get(config, leader, 2))
    await one(config, 101, n - 1, true);
    crash(config, leader)
    crash(config, get(config, leader, 1))
    connect(config, get(config, leader, 2))
    restart(config, leader)

    await one(config, 102, n - 1, true);
    restart(config, get(config, leader, 1))
    await one(config, 103, n, true);
}

async function TestUnreliableAgree2C(config: Config) {
    let n = config.servers.length;

    let promises = []
    for (let iter = 0; iter < 50; iter++) {
        promises.push(Promise.all([0, 1, 2, 3].map(i => one(config, (100 * iter) + i, 1, true))))
        await one(config, iter, 1, true)
    }
    let xs = await Promise.all(promises)
    await one(config, 100, n, true);
}

async function TestFigure82C(config: Config) {
    let n = config.servers.length;
    await one(config, 100, n, true);
    let upServers = new Set(config.servers);

    for (let iter = 0; iter < 1000; iter++) {
        let leader = "";
        for (let i = 0; i < n; i++) {
            let { index, term, isLeader } = await start(config, config.servers[i], Math.random() * 20)
            if (isLeader) leader = config.servers[i];
        }
        if (leader != "") {
            crash(config, leader)
            upServers.delete(leader);
        }
        if (Math.floor(Math.random() * 1000) < 100) await delay(Math.floor(Math.random() * 500));
        else await delay(Math.floor(Math.random() * 13));
        let s = config.servers[Math.floor(Math.random() * n)]
        if (!upServers.has(s)) {
            restart(config, s)
            upServers.add(s)
        }
    }
    for (let i = 0; i < n; i++) restart(config, config.servers[i])
    await one(config, 101, n, true);
}

async function snapcommon(name: string, disconnectf: boolean, reliable: boolean, crashf: boolean) {
    let servers = 3;
    let config = await make_generic_test(create_raft, servers, !reliable, true);
    try {
        console.log("---------------------- Starting", name)
        let iters = 32;
        await one(config, 0, servers, true)
        let leader1 = await check_one_leader(config);
        for (let i = 0; i < iters; i++) {
            let victim = get(config, leader1, 1)
            let sender = leader1
            if (i % 3 == 1) {
                sender = get(config, leader1, 1)
                victim = leader1
            }
            if (disconnectf) {
                disconnect(config, victim)
                await one(config, Math.random(), servers - 1, true)
            }
            if (crashf) {
                crash(config, victim)
                await one(config, Math.random(), servers - 1, true)
            }

            for (let j = 1; j < 11; j++) {
                await start(config, sender, i * 10 + j)
            }
            await one(config, (i + 1) * 10, servers - 1, true)
            //if cfg.LogSize() >= MAXLOGSIZE {
            //    cfg.t.Fatalf("Log size too large")
            //}

            if (disconnectf) {
                connect(config, victim)
                await one(config, Math.random(), servers, true)
                leader1 = await check_one_leader(config)
            }
            if (crashf) {
                restart(config, victim)
                let v = Math.random();
                console.log("trying ", v)
                await one(config, v, servers, true)
                leader1 = await check_one_leader(config)
            }
        }
    } finally {
        await stop_test(config)
    }
    console.log("----------------------Finished ", name)
}



await Test(TestInitialElection2A, 3)
await Test(TestReElection2A, 3)
await Test(TestManyElections2A, 7)
await Test(TestBasicAgree2B, 3)
await Test(TestFailAgree2B, 3)
await Test(TestFailNoAgree2B, 5)
await Test(TestRejoin2B, 3)
await Test(TestBackup2B, 5)
await Test(TestCount2B, 3)
await Test(TestPersist12C, 3)
await Test(TestPersist22C, 5)
await Test(TestPersist32C, 5)
await Test(TestUnreliableAgree2C, 5, true)
await Test(TestFigure82C, 5)
await Test(TestFigure82C, 5, true, true)
await snapcommon("Test (2D): snapshots basic", false, true, false);
await snapcommon("Test (2D): install snapshots (disconnect)", true, true, false);
await snapcommon("Test (2D): install snapshots (disconnect+unreliable)", true, false, false)
await snapcommon("Test (2D): install snapshots (crash)", false, true, true);
await snapcommon("Test (2D): install snapshots (unreliable+crash)", false, false, true);
