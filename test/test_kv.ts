import { spawn } from 'node:child_process'
import { make_generic_test, stop_test, check_one_leader, disconnect, connect, crash, restart, execute_porcupine, execute_clients, Config } from "./util.js"
import { delay, get_kv_port } from '../src/util.js';


export function create_kv(xs: string[]) {
    const srv = spawn('node', ['./built/test/bin_kv.js', ...xs]);
    srv.stdout.on('data', (data) => process.stdout.write(`--> ${xs[0]}: ${data}`));
    srv.stderr.on('data', (data) => process.stderr.write(`--> ${xs[0]}: ${data}`));
    return srv;
}

async function crash_leader(config: Config) {
    while (!config.stop) {
        let leader = await check_one_leader(config);
        crash(config, leader);
        await delay(500)
        restart(config, leader)
        await delay(500)
    }
}

async function disconnect_random(config: Config) {
    let servers = structuredClone(config.servers)
    while (!config.stop) {
        servers.sort(() => 0.5 - Math.random());
        disconnect(config, servers[0]);
        await delay(500)
        connect(config, servers[0])
        await delay(500)
    }
}


async function generic_test(nservers: number, unreliable: boolean, nclients: number, nactions: number, nkeys: number, disconnect: boolean, crash: boolean) {
    let config = await make_generic_test(create_kv, nservers, unreliable)
    const crashPromise = crash ? crash_leader(config).catch(() => { }) : Promise.resolve(1);
    const disconnectPromise = (disconnect) ? disconnect_random(config).catch(() => { }) : Promise.resolve(1);
    let res = await execute_clients(nclients, config.servers.map(i => `http://localhost:${get_kv_port(i)}`), nactions, nkeys)
    let code = await execute_porcupine(res)
    config.stop = true;
    await crashPromise
    await disconnectPromise
    await stop_test(config)
    if (code == 0) console.log("---------------Test Succeed--------------")
    else console.log("---------Test Failed---------------")
}



await generic_test(7, true, 7, 200, 20, true, true)
