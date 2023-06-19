
import express from 'express'
import { Roles, new_timer, save, get_port, load } from "./util.js"
import { StartElection, RequestVote } from "./election.js"
import { send_append_entries, AppendEntries, InstallSnapshot } from "./replication.js"
import { log_term_at, log_length, new_log, log_snapshot } from "./log.js"

export function commit(raft, item) {
    if (raft.role != Roles.Leader) return { index: -1, term: -1, isLeader: false };
    raft.log.items.push({ term: raft.term, item });
    save(raft);
    raft.lastReceivedLen[raft.me] = log_length(raft);
    raft.peers.map((to) => send_append_entries(raft, to));
    return { index: log_length(raft) - 1, term: raft.term, isLeader: true };
}

export function get_state(raft) {
    return { nodeId: raft.me, term: raft.term, isLeader: raft.role == Roles.Leader }
}

export function cond_install_snapshot(raft, lastTerm, len, snapshot) {
    if (log_snapshot(raft, len, lastTerm)) {
        raft.snapshot = snapshot;
        save(raft)
    }
    let oldCommitLen = raft.commitLen
    raft.appliedLen = Math.max(raft.appliedLen, len)
    raft.commitLen = Math.max(oldCommitLen, len)

    return oldCommitLen < len
}

export function snapshot(raft, len, snapshot) {
    if (len <= raft.log.snapshotLen || len > log_length(raft)) return
    if (log_snapshot(raft, len, log_term_at(raft, len - 1).term).term) {
        raft.snapshot = snapshot;
        save(raft)
    }
    raft.snapshot = snapshot;
    save(raft, snapshot)
}


export function start() {
    this.applier({ type: "Snapshot", snapshot: this.snapshot, snapshotTerm: this.log.snapshotTerm, snapshotLen: this.log.snapshotLen });
    this.reset_election_timer = new_timer(() => StartElection(this), () => Math.floor(Math.random() * 200 + 200));
    this.heartBeatTimers = this.peers.reduce((a, v) => ({ ...a, [v]: new_timer(() => send_append_entries(this, v), () => 100) }), {});
    this.server = express()
        .use(express.json())
        .use((err, req, res, next) => {
            console.log(err.stack);
            res.status(500).send('Something broke!')
        })
        .post('/RequestVote', (req, res) => res.send(RequestVote(this, req.body)))
        .post('/AppendEntries', (req, res) => res.send(AppendEntries(this, req.body)))
        .post('/InstallSnapshot', (req, res) => res.send(InstallSnapshot(this, req.body)))
        .listen(get_port(this.me), () => { })
    return this;
}

export function Raft(peers, me, applier) {
    let data = load(me);
    this.snapshot = data.snapshot;
    this.term = data.term || 0;
    this.lastVote = data.lastVote || -1;
    this.log = data.log || new_log();
    this.applier = applier;
    this.peers = peers;
    this.me = me;
    this.role = Roles.Follower;
    this.nextIndex = [me, ...peers].reduce((a, v) => ({ ...a, [v]: 0 }), {});
    this.lastReceivedLen = [me, ...peers].reduce((a, v) => ({ ...a, [v]: 0 }), {});
    this.commitLen = 0;
    this.appliedLen = 0;
    this.server = undefined;
    this.reset_election_timer = undefined;
    this.heartBeatTimers = [];
}

Raft.prototype.start = start;