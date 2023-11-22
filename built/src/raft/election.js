import { SendRPC, cast_vote } from "./util.js";
import { send_append_entries } from "./replication.js";
import { Roles, requestVoteArgs, requestVoteResponse } from "./types.js";
const requestVoteRPC = (to, args) => SendRPC(to, "RequestVote", args).catch(e => requestVoteResponse("", -1, false));
function process_vote(raft, vote, votes, resolve) {
    let majority = Math.floor(raft.peers.length / 2) + 1;
    if (raft.role != Roles.Candidate)
        resolve(false);
    if (vote.term > raft.term) {
        cast_vote(raft, Roles.Follower, vote.term, null);
        resolve(false);
    }
    if (vote.granted && vote.term == raft.term)
        votes.accepted++;
    else
        votes.rejected++;
    if (votes.accepted >= majority)
        resolve(true);
    else if (votes.rejected >= majority) {
        raft.role = Roles.Follower;
        resolve(false);
    }
}
export async function StartElection(raft) {
    if (raft.role != Roles.Follower)
        return;
    cast_vote(raft, Roles.Candidate, raft.term + 1, raft.me);
    let votes = { accepted: 1, rejected: 0 };
    let args = requestVoteArgs(raft.term, raft.me, raft.log.length(), raft.log.last_term());
    let ok = await new Promise(resolve => raft.peers.map(to => requestVoteRPC(to, args).then(vote => process_vote(raft, vote, votes, resolve))));
    if (ok) {
        console.log("I am leader", raft.me, raft.term);
        raft.reset_election_timer();
        raft.role = Roles.Leader;
        raft.lastReceivedLen[raft.me] = raft.log.length();
        raft.peers.forEach(element => {
            raft.nextIndex[element] = raft.log.length();
            raft.lastReceivedLen[element] = 0;
        });
        raft.peers.map((to) => send_append_entries(raft, to));
    }
}
export function RequestVote(raft, { term, candidateId, logLength, logTerm }) {
    if (term < raft.term)
        return requestVoteResponse(raft.me, raft.term, false);
    if (term > raft.term)
        cast_vote(raft, Roles.Follower, term, null);
    let myLogLength = raft.log.length();
    let myLogTerm = raft.log.last_term();
    let logOk = logTerm > myLogTerm || (logTerm == myLogTerm && logLength >= myLogLength);
    let termOk = raft.lastVote === null || raft.lastVote == candidateId;
    if (logOk && termOk) {
        cast_vote(raft, Roles.Follower, term, candidateId);
        raft.reset_election_timer();
        return requestVoteResponse(raft.me, raft.term, true);
    }
    return requestVoteResponse(raft.me, raft.term, false);
}
