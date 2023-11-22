
import express from 'express'
import { new_timer, save, load } from "./util.js"
import { StartElection, RequestVote } from "./election.js"
import { send_append_entries, AppendEntries, InstallSnapshot } from "./replication.js"
import { ApplyMsg, Raft, Roles, Log } from './types.js'
import { get_port } from '../util.js'

export function commit(raft: Raft, item: any) {
    if (raft.role != Roles.Leader) return { index: -1, term: -1, isLeader: false };
    raft.log.items.push({ term: raft.term, item });
    save(raft);
    raft.lastReceivedLen[raft.me] = raft.log.length();
    raft.peers.map((to) => send_append_entries(raft, to));
    return { index: raft.log.length() - 1, term: raft.term, isLeader: true };
}

export function get_state(raft: Raft) {
    return { nodeId: raft.me, term: raft.term, isLeader: raft.role == Roles.Leader }
}

export function cond_install_snapshot(raft: Raft, lastTerm: number, len: number, snapshot: any): boolean {
    if (raft.log.snapshot(len, lastTerm)) {
        raft.snapshot = snapshot;
        save(raft)
    }
    let oldLen = raft.appliedLen
    raft.appliedLen = Math.max(raft.appliedLen, len)
    raft.commitLen = Math.max(raft.commitLen, len)
    return oldLen < len
}

export function snapshot(raft: Raft, len: number, snapshot: any): void {
    if (len <= raft.log.snapshotLen || len > raft.log.length()) return
    let res = raft.log.term_at(len - 1)
    if (res.type == "OK" && raft.log.snapshot(len, res.term)) {
        raft.snapshot = snapshot;
        save(raft)
    }
}

export function start(raft: Raft) {
    raft.applier({ type: "Snapshot", snapshot: raft.snapshot, snapshotTerm: raft.log.snapshotTerm, snapshotLen: raft.log.snapshotLen })
    raft.reset_election_timer = new_timer(() => StartElection(raft), () => Math.floor(Math.random() * 200 + 200));
    raft.heartBeatTimers = raft.peers.reduce((a, v) => ({ ...a, [v]: new_timer(() => send_append_entries(raft, v), () => 100) }), {});
    express()
        .use(express.json())
        .use((err: any, req: any, res: any, next: any) => {
            console.log(err.stack);
            res.status(500).send('Something broke!')
        })
        .post('/RequestVote', (req, res) => res.send(RequestVote(raft, req.body)))
        .post('/AppendEntries', (req, res) => res.send(AppendEntries(raft, req.body)))
        .post('/InstallSnapshot', (req, res) => res.send(InstallSnapshot(raft, req.body)))
        .listen(get_port(raft.me), () => { })
}

export function new_raft(peers: string[], me: string, applier: ((arg: ApplyMsg) => void)): Raft {
    let data = load(me);
    return {
        snapshot: data.snapshot,
        term: data.term || 0,
        lastVote: data.lastVote || null,
        log: new Log(data.log?.items, data.log?.snapshotLen, data.log?.snapshotTerm),
        applier: applier,
        peers: peers,
        me: me,
        role: Roles.Follower,
        nextIndex: [me, ...peers].reduce((a, v) => ({ ...a, [v]: 0 }), {}),
        lastReceivedLen: [me, ...peers].reduce((a, v) => ({ ...a, [v]: 0 }), {}),
        commitLen: 0,
        appliedLen: 0,
        reset_election_timer: () => { },
        heartBeatTimers: {}
    }
}
