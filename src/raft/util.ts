import axios from "axios"
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import wf from 'write-file-atomic';
import { Raft, Roles, SavedState, RaftAPI } from "./types.js";



//https://stackoverflow.com/questions/63064393/getting-axios-error-connect-etimedout-when-making-high-volume-of-calls
export async function SendRPC<T extends keyof RaftAPI>(to: string, rpc_name: T, args: RaftAPI[T][0]): Promise<RaftAPI[T][1]> {
    return axios.post(new URL(rpc_name, to).href, args, { timeout: 300 }).then(i => i.data as RaftAPI[T][1]);
}

export function new_timer(action: () => void, timeoutFn: () => number): () => void {
    let timer = setInterval(action, timeoutFn());
    return () => {
        clearInterval(timer);
        timer = setInterval(action, timeoutFn());
    }
}

export function cast_vote(raft: Raft, role: Roles, term: number, votedFor: string | null): void {
    raft.role = role;
    raft.term = term;
    raft.lastVote = votedFor;
    save(raft)
}

export const getFileName = (me: string) => "data/" + new URL(me).hostname + "_" + new URL(me).port + ".json"


export function load(me: string): Partial<SavedState> {
    if (!existsSync("./data")) mkdirSync("./data");
    let filename = getFileName(me);
    try {
        let rawdata = readFileSync(filename, { encoding: "utf-8" });
        return JSON.parse(rawdata)
    } catch {
        return {}
    }
}

// on windows files are not flushed immediately with fsync so there is a loop
// wf.sync function creates a temp file and changes its name(seem to be atomic on windows)
// if the created file is not flushed before trying to change its name it gives an error.
export function save(raft: Raft) {
    let filename = getFileName(raft.me)
    let obj: SavedState = { lastVote: raft.lastVote, term: raft.term, log: raft.log, snapshot: raft.snapshot }
    while (true) {
        try {
            wf.sync(filename, JSON.stringify(obj, undefined, 2))
            return
        }
        catch (e) { }
    }
}