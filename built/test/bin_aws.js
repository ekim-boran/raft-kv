import { start_server } from "./raft_kv/server.js";
const [me, ...peers] = process.argv.slice(2);
let srv = await start_server(peers, me);
