import { start_server } from "../src/raft_kv/server.js";
import axios from "axios";
const [me, ...peers] = process.argv.slice(2);
function go(requestConfig) {
    return Object.assign(Object.assign({}, requestConfig), { url: new URL(new URL(requestConfig.url).pathname, "http://localhost:9000").href, data: Object.assign(Object.assign({}, requestConfig.data), { from: me, to: "http://" + new URL(requestConfig.url).host }) });
}
axios.interceptors.request.use(go);
start_server(peers, me);
