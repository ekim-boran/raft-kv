import { start_server } from "../raft_kv/server.js"
import { get_state } from "../raft/lib.js"
import express from 'express'
import axios from "axios"
import { get_debug_port } from "./util.js";

const [me, ...peers] = process.argv.slice(2);

function go(requestConfig) {
    return {
        ...requestConfig, url: new URL(new URL(requestConfig.url).pathname, "http://localhost:9000").href, data: {
            ...requestConfig.data, from: me,
            to: "http://" + new URL(requestConfig.url).host
        }
    };
}

axios.interceptors.request.use(go);

let srv = await start_server(peers, me);

const app = express();
app.use(express.json());

app.post('/State',  (req, res) => res.send(get_state(srv.raft)))
    .listen(get_debug_port(me), () => { })

