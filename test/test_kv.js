import { spawn } from 'node:child_process'
import { make_generic_test, stop_test, check_one_leader, delay, disconnect, connect, crash, restart, execute_porcupine, execute_clients } from "./util.js"
import { get_kv_port } from '../raft_kv/util.js';


export function create_kv(xs) {
    const srv = spawn('node', ['./test/bin_kv.js', ...xs]);
    srv.stdout.on('data', (data) => process.stdout.write(`--> ${xs[0]}: ${data}`));
    srv.stderr.on('data', (data) => process.stderr.write(`--> ${xs[0]}: ${data}`));
    return srv;
}

async function crash_leader(config) {
    while (!config.stop) {
        let leader = await check_one_leader(config);
        crash(config, leader);
        await delay(500)
        restart(config, leader)
        await delay(500)
    }
}

async function disconnect_random(config) {
    let servers = structuredClone(config.servers)
    while (!config.stop) {
        servers.sort(() => 0.5 - Math.random());
        disconnect(config, servers[0]);
        await delay(500)
        connect(config, servers[0])
        await delay(500)
    }
}


async function generic_test(nservers, unreliable, nclients, nactions, nkeys, disconnect, crash) {
    let config = await make_generic_test(create_kv, nservers, unreliable)
    const crashPromise = crash ? crash_leader(config).catch(() => { }) : Promise.resolve(1);
    const disconnectPromise = (disconnect) ? disconnect_random(config).catch(() => { }) : Promise.resolve(1);
    let res = await execute_clients(nclients, config.servers.map(i => `http://localhost:${get_kv_port(i)}`), nactions, nkeys)
    let code = await execute_porcupine(res)
    config.stop = true;
    await crashPromise
    await disconnectPromise
    stop_test(config)
    if (code == 0) console.log("---------------Test Succeed--------------")
    else console.log("---------Test Failed---------------")

}


//await generic_test(3, false,  1, 100, 1)
//await generic_test(5, false,  1, 100, 1)
//await generic_test(5, false,  1, 100, 2)
//await generic_test(3, true, 10, 100, 10)

await generic_test(7, true, 7, 200, 20, true, true)
