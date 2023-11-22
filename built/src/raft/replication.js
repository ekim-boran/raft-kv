var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
import { SendRPC, cast_vote, save, } from "./util.js";
import { Roles, appendEntriesArgs, appendEntriesResponse, installSnapshotArgs, installSnapshotResponse } from "./types.js";
const appendEntriesRPC = (to, args) => SendRPC(to, "AppendEntries", args).catch(_ => appendEntriesResponse(-1, false, -1, -1, -1));
const installSnapshotRPC = (to, args) => SendRPC(to, "InstallSnapshot", args).catch(_ => ({ term: -1 }));
export async function send_append_entries(raft, to) {
    if (raft.role != Roles.Leader)
        return;
    raft.heartBeatTimers[to]();
    let nextIndex = raft.nextIndex[to];
    let result = raft.log.term_at(nextIndex - 1);
    if (result.type == "OK") {
        let entries = raft.log.get_entries(nextIndex);
        let newIndex = entries.length + nextIndex;
        let args = appendEntriesArgs(raft.term, raft.me, nextIndex, result.term, entries, raft.commitLen);
        let reply = await appendEntriesRPC(to, args);
        let cont = process_append_response(raft, reply, to, newIndex);
        if (cont)
            await send_append_entries(raft, to);
    }
    else if (result.type == "InSnapshot") {
        let reply = await installSnapshotRPC(to, installSnapshotArgs(raft.term, result.snapshotTerm, result.snapshotLen, raft.snapshot));
        process_snapshot_response(raft, reply, to, result.snapshotLen);
    }
}
function change_leader_commit(raft, leaderCommit) {
    raft.commitLen = Math.max(raft.commitLen, leaderCommit);
    while (raft.appliedLen < raft.commitLen) {
        let item = raft.log.items[raft.appliedLen - raft.log.snapshotLen];
        if (item == undefined) {
            break;
        }
        raft.applier(Object.assign({ type: "Command", index: raft.appliedLen }, raft.log.items[raft.appliedLen - raft.log.snapshotLen]));
        raft.appliedLen++;
    }
}
function get_leader_commit(raft) {
    let index = Object.values(raft.lastReceivedLen).sort((a, b) => a - b)[Math.floor(raft.peers.length / 2)];
    let result = raft.log.term_at(index - 1);
    if (result.type == "OK" && result.term == raft.term)
        return index;
    else
        return raft.commitLen;
}
function process_append_response(raft, { term, success, xlen, xterm, xindex }, to, newIndex) {
    if (term > raft.term) {
        cast_vote(raft, Roles.Follower, term, null);
        return false;
    }
    else if (success) {
        raft.nextIndex[to] = Math.max(raft.nextIndex[to], newIndex);
        raft.lastReceivedLen[to] = Math.max(raft.lastReceivedLen[to], newIndex);
        let newLeaderCommit = get_leader_commit(raft);
        change_leader_commit(raft, newLeaderCommit);
        return false;
    }
    else if (xlen != -1) {
        raft.nextIndex[to] = xlen;
        return true;
    }
    else if (xterm != -1 && xindex != -1) {
        let index = raft.log.search_rightmost_term(xterm);
        raft.nextIndex[to] = xindex; //index == -1 ? xindex : index;
        // TODO fix xterm
        return true;
    }
    return false;
}
function process_snapshot_response(raft, { term }, to, newIndex) {
    if (term > raft.term)
        cast_vote(raft, Roles.Follower, term, null);
    else
        raft.nextIndex[to] = Math.max(raft.nextIndex[to], newIndex);
}
export function AppendEntries(raft, { term, startIndex, leaderCommit, entries, prevLogTerm }) {
    if (term < raft.term)
        return appendEntriesResponse(raft.term, false, -1, -1, -1);
    raft.reset_election_timer();
    if (term > raft.term)
        cast_vote(raft, Roles.Follower, term, null);
    if (term == raft.term && raft.role == Roles.Candidate)
        raft.role = Roles.Follower;
    let result = raft.log.term_at(startIndex - 1);
    if (result.type == "OK" && result.term != prevLogTerm)
        return appendEntriesResponse(raft.term, false, result.term, -1, raft.log.search_leftmost_term(result.term));
    else if (result.type == "InSnapshot")
        return appendEntriesResponse(raft.term, false, -1, result.snapshotLen, -1);
    else if (result.type == "OutOfBounds")
        return appendEntriesResponse(raft.term, false, -1, result.len, -1);
    raft.log.append_entries(startIndex, entries);
    save(raft);
    change_leader_commit(raft, leaderCommit);
    return appendEntriesResponse(raft.term, true, -1, -1, -1);
}
export function InstallSnapshot(raft, _a) {
    var { term } = _a, other = __rest(_a, ["term"]);
    if (term < raft.term)
        return installSnapshotResponse(raft.term);
    raft.reset_election_timer();
    if (term > raft.term)
        cast_vote(raft, Roles.Follower, term, null);
    if (term == raft.term && raft.role == Roles.Candidate)
        raft.role = Roles.Follower;
    raft.applier(Object.assign({ type: "Snapshot" }, other));
    return installSnapshotResponse(raft.term);
}
