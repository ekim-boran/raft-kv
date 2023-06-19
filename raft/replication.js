import { Roles, SendRPC, cast_vote, save, } from "./util.js"
import { log_term_at, log_get_entries, log_append_entries, log_search_leftmost_term, log_search_rightmost_term } from "./log.js"

const appendEntriesResponse = (term, success, xterm, xlen, xindex) => ({ term, success, xterm, xlen, xindex });
const appendEntriesArgs = (term, leaderId, startIndex, prevLogTerm, entries, leaderCommit) => ({ term, leaderId, startIndex, prevLogTerm, entries, leaderCommit });
const installSnapshotArgs = (term, snapshotTerm, snapshotLen, snapshot) => ({ term, snapshotTerm, snapshotLen, snapshot });
const installSnapshotResponse = (term) => { { term } };
const appendEntriesRPC = (raft, to, args) => SendRPC(raft, to, "AppendEntries", args).catch(_ => appendEntriesResponse(-1, false, -1, -1, -1));
const installSnapshotRPC = (raft, to, args) => SendRPC(raft, to, "InstallSnapshot", args).catch(_ => ({ term: -1 }));


export async function send_append_entries(raft, to) {
    if (raft.role != Roles.Leader) return;
    raft.heartBeatTimers[to]();
    let nextIndex = raft.nextIndex[to];
    let result = log_term_at(raft, nextIndex - 1);
    if (result.type == "OK") {
        let entries = log_get_entries(raft, nextIndex);
        let newIndex = entries.length + nextIndex
        let args = appendEntriesArgs(raft.term, raft.me, nextIndex, result.term, entries, raft.commitLen)
        let reply = await appendEntriesRPC(raft, to, args);
        let cont = process_append_response(raft, reply, to, newIndex);
        if (cont) await send_append_entries(raft, to)
    }
    else if (result.type == "InSnapshot") {
        let reply = await installSnapshotRPC(raft, to, installSnapshotArgs(raft.term, result.snapshotTerm, result.snapshotLen, raft.snapshot));
        process_snapshot_response(raft, reply, to, result.snapshotLen);
    }
}

function change_leader_commit(raft, leaderCommit) {
    raft.commitLen = Math.max(raft.commitLen, leaderCommit);
    while (raft.appliedLen < raft.commitLen) {
        let item = raft.log.items[raft.appliedLen - raft.log.snapshotLen];
        if (item == undefined) {
            break
        }
        raft.applier({ type: "Command", index: raft.appliedLen, ...raft.log.items[raft.appliedLen - raft.log.snapshotLen] })
        raft.appliedLen++;
    }
}

function get_leader_commit(raft) {
    let index = Object.values(raft.lastReceivedLen).sort((a, b) => a - b)[Math.floor(raft.peers.length / 2)];
    let result = log_term_at(raft, index - 1);
    if (result.type == "OK" && result.term == raft.term) return index;
    else return raft.commitLen
}

function process_append_response(raft, { term, success, xlen, xterm, xindex }, to, newIndex) {
    if (term > raft.term) {
        cast_vote(raft, Roles.Follower, term, -1);
        return false
    }
    else if (success) {
        raft.nextIndex[to] = Math.max(raft.nextIndex[to], newIndex);
        raft.lastReceivedLen[to] = Math.max(raft.lastReceivedLen[to], newIndex);
        let newLeaderCommit = get_leader_commit(raft);
        change_leader_commit(raft, newLeaderCommit);
        return false
    } else if (xlen != -1) {
        raft.nextIndex[to] = xlen;
        return true
    } else if (xterm != -1 && xindex != -1) {
        let index = log_search_rightmost_term(raft, xterm)
        raft.nextIndex[to] = xindex//index == -1 ? xindex : index;
        // TODO fix xterm
        return true
    }
}

function process_snapshot_response(raft, { term }, to, newIndex) {
    if (term > raft.term) cast_vote(raft, Roles.Follower, term, -1);
    else raft.nextIndex[to] = Math.max(raft.nextIndex[to], newIndex);
}


export function AppendEntries(raft, { term, startIndex, leaderCommit, entries, prevLogTerm }) {
    if (term < raft.term) return appendEntriesResponse(raft.term, false, -1, -1, -1);
    raft.reset_election_timer();
    if (term > raft.term) cast_vote(raft, Roles.Follower, term, -1);
    if (term == raft.term && raft.role == Roles.Candidate) raft.role = Roles.Follower;
    let result = log_term_at(raft, startIndex - 1);
    if (result.type == "OK" && result.term != prevLogTerm) return appendEntriesResponse(raft.term, false, result.term, -1, log_search_leftmost_term(raft, result.term));
    else if (result.type == "InSnapshot") return appendEntriesResponse(raft.term, false, -1, result.snapshotLen, -1);
    else if (result.type == "OutOfBounds") return appendEntriesResponse(raft.term, false, -1, result.len, -1);
    log_append_entries(raft, startIndex, entries);
    save(raft);
    change_leader_commit(raft, leaderCommit);
    return appendEntriesResponse(raft.term, true, -1, -1, -1);
}

export function InstallSnapshot(raft, { term, ...other }) {
    if (term < raft.term) return installSnapshotResponse(raft.term);
    raft.reset_election_timer();
    if (term > raft.term) cast_vote(raft, Roles.Follower, term, -1);
    if (term == raft.term && raft.role == Roles.Candidate) raft.role = Roles.Follower;
    raft.applier({ type: "Snapshot", ...other })
}